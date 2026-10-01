# Suspected personal-data breach

Template, per `docs/11` → Incident basics and `docs/08`. Write in a private note as you go: times in UTC, who did what.

1. **Contain** (first hour): rotate the leaked secret ([rotate-secrets.md](rotate-secrets.md)), disable the affected tool or feature ([disable-a-tool.md](disable-a-tool.md)), stop the leak.
2. **Assess**: what data (accounts' emails? ledger? job metadata?), how many people, since when, is it still exposed? User files live at most an hour, so check whether any were in storage at the time.
3. **Decide** within 72 h of becoming aware: notify the supervisory authority where the law requires it (GDPR art. 33; record the decision either way).
4. **Tell users** if the risk to them is high: what happened, what data, what we did, what they can do.
5. **Record**: what happened, the effects, what was done, what changes so it doesn't happen again.
