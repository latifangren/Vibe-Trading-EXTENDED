from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from .approval import ApprovalState
from .decision import AdvisoryDecision
from .journal import DecisionJournal, JournalEntry


class AdvisoryJournalStore:
    def __init__(self, path: Path) -> None:
        self.path: Path = Path(path)

    def load(self) -> DecisionJournal:
        if not self.path.exists():
            return DecisionJournal()
        try:
            payload = cast(object, json.loads(self.path.read_text(encoding="utf-8")))
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid advisory journal JSON: {self.path}") from exc
        return DecisionJournal.from_dict(payload)

    def save(self, journal: DecisionJournal) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        _ = tmp_path.write_text(
            json.dumps(journal.to_dict(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        _ = tmp_path.replace(self.path)

    def append(self, decision: AdvisoryDecision, approval: ApprovalState | None = None) -> JournalEntry:
        journal = self.load()
        entry = journal.append(decision, approval=approval)
        self.save(journal)
        return entry
