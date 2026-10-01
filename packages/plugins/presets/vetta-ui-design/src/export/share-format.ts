/**
 * 分享包的扩展名。
 *
 * 工作态从 v2 起是 `x.vetd/` **目录**（ADR-0066），分享包仍是单个 zip 文件，
 * 两者不能再共用 `.vetd`：同一个扩展名一半是目录一半是文件，文件树、系统关联和
 * 「双击会发生什么」全都说不清。`.567design` 是新的分享包扩展名；历史 `.vetdz`
 * 与更早的 `-share.vetd` 仍能导入（读取端按内容嗅探，见 VetdPreview）。
 */
export const SHARE_EXTENSION = "567design";

/** 能被当作分享包打开的扩展名：新格式及两种历史扩展名。 */
export const SHARE_PREVIEW_EXTENSIONS = [SHARE_EXTENSION, "vetdz", "vetd"] as const;
