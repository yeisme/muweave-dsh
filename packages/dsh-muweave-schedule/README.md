# @yeisme/dsh-muweave-schedule

幕织创作套件的排期房间：把 `.muweave/` 里的场次、分镜和成稿排到具体哪一天。

- 月历（周一起始）+ 待排池；点选后点某天排期，或直接把待排项拖到某天；点日历上的条目取消。
- 数据落 `~/.dsh/plugin-data/muweave-dsh/schedule.v1.json`（0600、原子写、损坏改名隔离、上限 500 条），不进 `.muweave/`，不改任何 owner 目录。
- 共享 RPC：`schedule.list` / `schedule.plan` / `schedule.clear`；智能体侧对应 `muweave_schedule_list` / `muweave_schedule_plan` / `muweave_schedule_clear`。
- 排期是本地、可逆、不花钱的操作，因此智能体可直接写；付费生成仍然只能由用户在生成台批准。

设计说明见 `docs/design/desk-v4.md`。
