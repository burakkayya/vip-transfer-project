"""RT-01: ARQ işleri pickle yerine JSON ile (de)serialize edilir (remediation-plan F0-6)."""

from __future__ import annotations

import pickle
import uuid
from datetime import datetime, timezone

import pytest
from arq.jobs import DeserializationError, deserialize_job_raw, serialize_job
from arq.worker import get_kwargs

from app.worker import WorkerSettings

_SIDE_EFFECTS: list[str] = []


def _record(marker: str) -> str:
    """Zararsız 'yük': pickle açılırken çağrılırsa iz bırakır."""
    _SIDE_EFFECTS.append(marker)
    return marker


class _Gadget:
    def __reduce__(self):
        return (_record, ("pickle-calisti",))


def test_worker_settings_use_json_serializer():
    kwargs = get_kwargs(WorkerSettings)
    ser = kwargs.get("job_serializer")
    de = kwargs.get("job_deserializer")
    assert ser is not None and de is not None
    raw = serialize_job("every_minute", (), {}, 1, 1_700_000_000_000, serializer=ser)
    assert raw.startswith(b"{")  # JSON, pickle değil
    assert deserialize_job_raw(raw, deserializer=de) == ("every_minute", [], {}, 1, 1_700_000_000_000)


def test_worker_serializer_handles_datetime_and_uuid():
    ser = get_kwargs(WorkerSettings)["job_serializer"]
    de = get_kwargs(WorkerSettings)["job_deserializer"]
    when = datetime(2026, 11, 12, 10, 0, tzinfo=timezone.utc)
    ident = uuid.UUID("12345678-1234-5678-1234-567812345678")
    raw = serialize_job("f", (when, ident), {}, 1, 0, serializer=ser)
    _, args, _, _, _ = deserialize_job_raw(raw, deserializer=de)
    assert args == [when.isoformat(), str(ident)]


def test_worker_rejects_pickle_job_payload():
    _SIDE_EFFECTS.clear()
    payload = pickle.dumps({"t": 1, "f": "every_minute", "a": (_Gadget(),), "k": {}, "et": 0})
    deserializer = get_kwargs(WorkerSettings).get("job_deserializer")
    with pytest.raises(DeserializationError):
        deserialize_job_raw(payload, deserializer=deserializer)
    assert _SIDE_EFFECTS == []
