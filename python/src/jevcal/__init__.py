from .adapters import JevAdapter, JevAdapterConfig
from .calibration import compute_brier_score, compute_ece, compute_reliability_diagram
from .report import CalibrationReport, get_calibration
from .router import BackendAdapter, DecisionRouter, build_field_predictions, extract_self_reported, normalize_confidence
from .schema import DecisionSchema, confidence_field_key, define_decision
from .sqlite_store import SqliteStore
from .store import JsonlStore
from .types import (
    CalibrationSample,
    ConfidenceSignal,
    ConfidenceStrategy,
    DecisionInput,
    DecisionResult,
    FieldPrediction,
    LoggedDecisionRecord,
    LogprobSignal,
    NativeSignal,
    NoneSignal,
    OutcomeLabel,
    RawBackendResponse,
    ReliabilityBin,
    SelfReportedSignal,
)

__version__ = "0.2.0"

__all__ = [
    "BackendAdapter",
    "CalibrationReport",
    "CalibrationSample",
    "ConfidenceSignal",
    "ConfidenceStrategy",
    "DecisionInput",
    "DecisionResult",
    "DecisionRouter",
    "DecisionSchema",
    "FieldPrediction",
    "JevAdapter",
    "JevAdapterConfig",
    "JsonlStore",
    "LoggedDecisionRecord",
    "LogprobSignal",
    "NativeSignal",
    "NoneSignal",
    "OutcomeLabel",
    "RawBackendResponse",
    "ReliabilityBin",
    "SelfReportedSignal",
    "SqliteStore",
    "build_field_predictions",
    "compute_brier_score",
    "compute_ece",
    "compute_reliability_diagram",
    "confidence_field_key",
    "define_decision",
    "extract_self_reported",
    "get_calibration",
    "normalize_confidence",
]
