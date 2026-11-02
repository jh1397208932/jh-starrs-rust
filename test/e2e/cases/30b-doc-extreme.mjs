/**
 * 文档极限场景：大正文一次写入 + 反复保存后，字数/块数落库正确，历史快照有上限。
 *
 * 判据落库：
 * 1. 200 段正文写入后 `doc_block_tree` 块数达到 200、`node.word_count` 大于 0；
 * 2. 连续 10 次改写并保存后，状态回到「已保存」，块数不变；
 * 3. `doc_history` 只保留首份 + 10 分钟一份的快照，连续保存不会堆出几十份；
 * 4. 完成后侧栏「更多」仍可打开（界面没有被长文档拖死）。
 */
export default {
  id: "30b-doc-extreme",
  title: "文档 · 极限场景（大正文 / 反复保存 / 快照上限）",
  area: "文档编辑器",
  steps: [
    {
      action: "新建文档并写入 200 段正文",
      ui: "新建内容 → 文档 → 创建 → 文档正文",
      clicks: 3,
      dialogs: 1,
      typing: 1,
      note: "一次写入大正文，验证保存与索引链路在长文档下不丢块。",
    },
    {
      action: "连续改写 10 次",
      ui: "文档正文",
      clicks: 1,
      dialogs: 0,
      typing: 10,
      note: "模拟高频保存，验证保存链不会背靠背连打、状态能回到已保存。",
    },
    {
      action: "校验历史快照上限",
      ui: "（数据库判据）",
      clicks: 0,
      dialogs: 0,
      note: "doc_history 只允许首份与 10 分钟快照，连续保存不得堆满。",
    },
  ],
  complexity: {
    clickTotal: 4,
    dialogs: 1,
    typingFields: 11,
    assessment:
      "长文档的极限路径：一次大写入 + 十次改写。判据全部落在块表、字数与历史表上，能直接暴露块丢失、保存链失控与快照无上限三类问题。",
  },
  async run(ctx) {
    const title = "E2E 极限文档";
    const paragraph = "这是用于极限场景验证的正文段落，包含中英文混排 Performance text 以及数字 0123456789。";
    const bigText = Array.from(
      { length: 200 },
      (_, index) => `## 段落 ${index + 1}\n\n${paragraph}`,
    ).join("\n\n");

    await ctx.press("新建内容");
    await ctx.expectText("创建");
    await ctx.fill("名称", title);
    await ctx.press("文档");
    await ctx.press("创建");
    await ctx.expectText(title, { timeout: 10_000 });
    await ctx.expectText("文档正文", { timeout: 15_000 });
    ctx.metrics.dialogs += 1;

    await ctx.fill("文档正文", bigText);
    await ctx.expectText("已保存", { timeout: 30_000 });
    const blocks = await ctx.waitForDb(
      "SELECT COUNT(*) AS count FROM doc_block_tree",
      [],
      (rows) => rows.length === 1 && rows[0].count >= 200,
      { timeout: 20_000 },
    );
    ctx.log(`极限文档块数：${blocks[0].count}`);
    const words = ctx.db("SELECT word_count FROM node WHERE title = ?", [title]);
    if (!(words[0].word_count > 0)) throw new Error("文档字数未更新");

    let previousVersion = ctx.db("SELECT doc_version FROM node WHERE title = ?", [title])[0].doc_version;
    for (let round = 1; round <= 10; round += 1) {
      await ctx.fill("文档正文", `${bigText}\n\n追加第 ${round} 轮内容。`);
      // 以库里的 doc_version 为准：界面上的「已保存」可能是上一轮留下的，不能单独当作落库证据。
      await ctx.waitForDb(
        "SELECT doc_version FROM node WHERE title = ?",
        [title],
        (rows) => rows.length === 1 && rows[0].doc_version > previousVersion,
        { timeout: 20_000 },
      );
      previousVersion = ctx.db("SELECT doc_version FROM node WHERE title = ?", [title])[0].doc_version;
      await ctx.expectText("已保存", { timeout: 20_000 });
    }
    const docId = ctx.db("SELECT id FROM node WHERE title = ?", [title])[0].id;
    const after = ctx.db(
      "SELECT COUNT(*) AS count FROM doc_block_tree WHERE node_id = ?",
      [docId],
    )[0].count;
    if (after < 200) throw new Error(`反复保存后块数回退：${after}`);

    // 只统计本文档：同一次全量里其它用例也会各留首份快照，全库计数会被它们顶高。
    const snapshots = ctx.db(
      "SELECT COUNT(*) AS count FROM doc_history WHERE node_id = ?",
      [docId],
    )[0].count;
    ctx.log(`极限文档历史快照：${snapshots} 份`);
    if (snapshots > 3) throw new Error(`历史快照过多：${snapshots}`);

    // 界面仍可交互：打开「更多」菜单再关闭
    await ctx.press("更多 ⌘J");
    await ctx.expectText("设置", { timeout: 5000 });
    await ctx.key("escape");
  },
};
