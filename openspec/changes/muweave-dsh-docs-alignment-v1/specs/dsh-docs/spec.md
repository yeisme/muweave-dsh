# 文档事实对齐

## ADDED Requirements

### Requirement: Room and stage tab mapping is explicit

The design documentation SHALL provide a source-linked mapping of every registered MuWeave theater room and its stage tab IDs. Shortcut placeholders SHALL remain distinct from registered rooms.

#### Scenario: A maintainer checks room count

- **WHEN** the maintainer reads docs/design/tab-room-mapping.md
- **THEN** the document identifies seven registered rooms, twenty-one stage tabs, the Workbench Draft extra room, and the room-1..9 shortcut boundary with source paths

### Requirement: Delivery status follows committed implementation evidence

The v8 and project-management documentation SHALL mark F3 project diagnosis as delivered by 54d1374 and schedule v2 as delivered by fadbe67. Registry migration reporting SHALL remain explicitly marked as undelivered until an implementation commit exists.

#### Scenario: A maintainer checks remaining P2 work

- **WHEN** the maintainer reads the v8 spec, project feature design, F3 delivery report, and schedule v2 delivery report
- **THEN** F3 and schedule v2 are described as delivered with their commit evidence, while registry migration reporting is the only remaining P2 item
