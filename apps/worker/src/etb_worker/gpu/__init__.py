"""GPU tools (docs/01 -> GPU backend): the Modal app, the backend the worker calls, the weights."""

#: The Modal app every GPU function lives in (modal_app.py), deployed by CI.
APP_NAME = "edittoolbelt-gpu"

#: The longest idle window of any GPU function (modal_app.SPECS' ``scaledown``; a test holds
#: them together). A call that couldn't say what it used (cancelled, timed out, its worker
#: died) is billed its wall-clock time plus this, so the budget errs high.
MAX_IDLE_TAIL_SEC = 30
