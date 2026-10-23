//! 物理对象存储：流式哈希、big 原子发布、pack 追加/读取、下载与校验。
//!
//! 所有读写使用固定 256 KiB 缓冲；绝不把整文件载入内存。

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use blake3::Hasher;

use crate::domain::attachment::{
    STREAM_BUFFER_BYTES, TEMP_DIR_RELATIVE, big_relative_path, ensure_storage_layout,
    pack_relative_path, validate_hash, validate_pack_id,
};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{AttachmentBlobRow, KIND_BIG, KIND_PACK};
use crate::utils::new_id;

/// 已落盘的临时文件；哈希与大小在流式写入时计算。
pub struct StagedFile {
    pub path: PathBuf,
    pub hash: String,
    pub size: u64,
}

/// 把源文件流式复制到 storage/tmp，同时计算 BLAKE3。
pub fn stage_file(source: &Path, root: &Path) -> AppResult<StagedFile> {
    let metadata = fs::metadata(source).map_err(|error| {
        logging::error("attachment", &format!("读取源文件元数据失败: {error}"));
        AppError::validation("源文件不存在或不可读取")
    })?;
    if !metadata.is_file() {
        return Err(AppError::validation("只能上传普通文件"));
    }
    ensure_storage_layout(root)?;
    let file = File::open(source)?;
    stage_reader(file, root)
}

/// 把内存字节写入 storage/tmp；仅用于粘贴/拖放等已有字节流。
pub fn stage_bytes(bytes: &[u8], root: &Path) -> AppResult<StagedFile> {
    ensure_storage_layout(root)?;
    stage_reader(std::io::Cursor::new(bytes), root)
}

/// 通用流式暂存：固定 256 KiB 缓冲，边写边算哈希。
///
/// 写入期用唯一临时名，避免并发上传互相踩；写完后统一改名为 `<BLAKE3>.part`，
/// 因此暂存区、big 目录与 pack 文件名里都不会出现用户真实文件名。
fn stage_reader(mut reader: impl Read, root: &Path) -> AppResult<StagedFile> {
    let scratch = root
        .join(TEMP_DIR_RELATIVE)
        .join(format!(".{}.writing", new_id()));
    let hashed = (|| -> AppResult<StagedFile> {
        let mut target = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&scratch)?;
        let mut hasher = Hasher::new();
        let mut buffer = vec![0_u8; STREAM_BUFFER_BYTES];
        let mut size = 0_u64;
        loop {
            let read = reader.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            target.write_all(&buffer[..read])?;
            size += read as u64;
        }
        target.flush()?;
        target.sync_all()?;
        Ok(StagedFile {
            path: scratch.clone(),
            hash: hasher.finalize().to_hex().to_string(),
            size,
        })
    })();

    let staged = match hashed {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&scratch);
            return Err(error);
        }
    };

    let hashed_path = root
        .join(TEMP_DIR_RELATIVE)
        .join(format!("{}.part", staged.hash));
    if hashed_path.exists() {
        // 同内容已在暂存区（并发上传或崩溃残留）：字节完全一致，直接采用既有路径。
        let _ = fs::remove_file(&scratch);
    } else {
        fs::rename(&scratch, &hashed_path)?;
    }
    Ok(StagedFile {
        path: hashed_path,
        hash: staged.hash,
        size: staged.size,
    })
}

/// 把已 fsync 的临时文件原子发布到 big 哈希路径。
///
/// 调用方必须已确认该哈希没有活跃 blob；同哈希的孤儿文件会被替换。
pub fn publish_big(root: &Path, staged: &StagedFile) -> AppResult<PathBuf> {
    let relative = big_relative_path(&staged.hash)?;
    let destination = root.join(relative);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    if destination.exists() {
        fs::remove_file(&destination)?;
    }
    fs::rename(&staged.path, &destination)?;
    sync_parent_dir(&destination);
    Ok(destination)
}

/// 将临时文件追加进 pack；先截掉崩溃遗留的未索引尾部。
///
/// @returns 追加后的 pack 文件长度
pub fn append_to_pack(
    root: &Path,
    pack_id: &str,
    staged: &StagedFile,
    indexed_end: i64,
) -> AppResult<i64> {
    validate_pack_id(pack_id)?;
    if indexed_end < 0 {
        return Err(AppError::Internal);
    }
    let path = root.join(pack_relative_path(pack_id)?);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut target = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)?;
    let actual_len = target.metadata()?.len();
    let indexed_end = indexed_end as u64;
    if actual_len < indexed_end {
        logging::error(
            "attachment",
            &format!("pack {pack_id} 实际长度小于索引长度，疑似损坏"),
        );
        return Err(AppError::Internal);
    }
    if actual_len > indexed_end {
        target.set_len(indexed_end)?;
    }
    target.seek(SeekFrom::Start(indexed_end))?;

    let mut source = File::open(&staged.path)?;
    let mut buffer = vec![0_u8; STREAM_BUFFER_BYTES];
    let mut written = 0_u64;
    loop {
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        target.write_all(&buffer[..read])?;
        written += read as u64;
    }
    target.flush()?;
    target.sync_all()?;
    if written != staged.size {
        return Err(AppError::Internal);
    }
    Ok((indexed_end + written) as i64)
}

/// 事务失败时把 pack 截回追加前长度。
pub fn rollback_pack_append(root: &Path, pack_id: &str, target_len: i64) -> AppResult<()> {
    validate_pack_id(pack_id)?;
    if target_len < 0 {
        return Err(AppError::Internal);
    }
    let path = root.join(pack_relative_path(pack_id)?);
    let file = match OpenOptions::new().write(true).open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if file.metadata()?.len() > target_len as u64 {
        file.set_len(target_len as u64)?;
        file.sync_all()?;
    }
    Ok(())
}

/// 删除临时文件；失败只记录，不影响主流程。
pub fn cleanup_staged(path: &Path) {
    if let Err(error) = fs::remove_file(path)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        logging::error("attachment", &format!("清理临时文件失败: {error}"));
    }
}

/// 读取 blob 的原始字节，按固定缓冲交给 sink；返回字节数。
///
/// big 必须与元数据大小完全一致；pack 必须能从 offset 读到 length 字节。
pub fn read_blob(
    blob: &AttachmentBlobRow,
    root: &Path,
    mut sink: impl FnMut(&[u8]) -> AppResult<()>,
) -> AppResult<u64> {
    let expected = u64::try_from(blob.size).map_err(|_| AppError::Internal)?;
    let mut buffer = vec![0_u8; STREAM_BUFFER_BYTES];
    match blob.storage_kind.as_str() {
        KIND_BIG => {
            validate_hash(&blob.hash)?;
            let path = root.join(big_relative_path(&blob.hash)?);
            let mut file = File::open(&path).map_err(|error| {
                logging::error("attachment", &format!("打开 big 对象失败: {error}"));
                AppError::FileSystem
            })?;
            let file_len = file.metadata()?.len();
            if file_len < expected {
                return Err(AppError::Internal);
            }
            let mut total = 0_u64;
            while total < expected {
                let remaining = expected - total;
                let want = remaining.min(STREAM_BUFFER_BYTES as u64) as usize;
                let read = file.read(&mut buffer[..want])?;
                if read == 0 {
                    return Err(AppError::Internal);
                }
                sink(&buffer[..read])?;
                total += read as u64;
            }
            if file_len > expected {
                return Err(AppError::Internal);
            }
            Ok(total)
        }
        KIND_PACK => {
            let pack_id = blob.pack_id.as_deref().ok_or(AppError::Internal)?;
            let offset = blob.pack_offset.ok_or(AppError::Internal)?;
            if offset < 0 {
                return Err(AppError::Internal);
            }
            validate_pack_id(pack_id)?;
            let path = root.join(pack_relative_path(pack_id)?);
            let mut file = File::open(&path).map_err(|error| {
                logging::error("attachment", &format!("打开 pack 失败: {error}"));
                AppError::FileSystem
            })?;
            file.seek(SeekFrom::Start(offset as u64))?;
            let mut total = 0_u64;
            while total < expected {
                let remaining = expected - total;
                let want = remaining.min(STREAM_BUFFER_BYTES as u64) as usize;
                let read = file.read(&mut buffer[..want])?;
                if read == 0 {
                    logging::error(
                        "attachment",
                        &format!("pack {pack_id} 条目提前 EOF，疑似损坏"),
                    );
                    return Err(AppError::Internal);
                }
                sink(&buffer[..read])?;
                total += read as u64;
            }
            Ok(total)
        }
        _ => Err(AppError::Internal),
    }
}

/// 流式校验 blob：返回实际字节数与计算出的哈希。
pub fn verify_blob(blob: &AttachmentBlobRow, root: &Path) -> AppResult<(u64, String)> {
    let mut hasher = Hasher::new();
    let total = read_blob(blob, root, |chunk| {
        hasher.update(chunk);
        Ok(())
    })?;
    Ok((total, hasher.finalize().to_hex().to_string()))
}

/// 流式下载到用户目标路径：先写同目录临时文件，成功后原子替换。
pub fn download_to_path(
    blob: &AttachmentBlobRow,
    root: &Path,
    destination: &Path,
    overwrite: bool,
) -> AppResult<u64> {
    if !destination.is_absolute() {
        return Err(AppError::validation("下载目标必须是绝对路径"));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::validation("下载目标路径无效"))?;
    if !parent.is_dir() {
        return Err(AppError::validation("下载目标文件夹不存在"));
    }
    if destination.is_dir() {
        return Err(AppError::validation("下载目标不能是文件夹"));
    }
    if let (Ok(storage), Ok(parent_canonical)) = (root.canonicalize(), parent.canonicalize())
        && parent_canonical.starts_with(&storage)
    {
        return Err(AppError::validation("下载目标不能位于附件存储目录内"));
    }
    if destination.exists() && !overwrite {
        return Err(AppError::conflict("目标文件已存在"));
    }
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::validation("下载目标文件名无效"))?;
    let temp_path = parent.join(format!(".{file_name}.starris-{}.part", new_id()));

    let result = (|| {
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)?;
        let size = read_blob(blob, root, |chunk| {
            output.write_all(chunk)?;
            Ok(())
        })?;
        output.flush()?;
        output.sync_all()?;
        drop(output);

        if destination.exists() {
            fs::remove_file(destination)?;
        }
        fs::rename(&temp_path, destination)?;
        sync_parent_dir(destination);
        Ok(size)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

/// 在 Unix 上 fsync 父目录；Windows 不支持打开目录，跳过。
fn sync_parent_dir(path: &Path) {
    #[cfg(unix)]
    {
        if let Some(parent) = path.parent()
            && let Ok(directory) = File::open(parent)
            && let Err(error) = directory.sync_all()
        {
            logging::error("attachment", &format!("同步对象目录失败: {error}"));
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}
