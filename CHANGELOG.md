# Changelog

## 0.1.0 (beta)

First public release, built for Wazuh 4.14.x.

- Automatic discovery of log sources per agent (location and Windows event channel)
- Adaptive per-source baselines (p95 of recent gaps between appearances) with a warm-up period
- Source states: Learning, Healthy, Delayed, Silent, Volume drop, Missing
- Contracts: required sources per Wazuh agent group, with a Missing state for sources never seen
- Detection coverage per source: rules, MITRE techniques and tactics the source feeds
- Native Wazuh alerts through the Wazuh server API and a bundled rule pack (100700-100706)
- Dashboard UI: summary cards, filters, per-source panel with history, coverage and gap override, contracts editor
- Event-driven Wazuh internals ignored by default; stale sources forgotten after 30 days
