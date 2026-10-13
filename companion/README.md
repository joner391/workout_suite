# Companion Workspace (Python 3.11+)

Advanced analytics and scientific modeling companion suite for Workout Suite.

## Virtual Environment Setup
Ensure commands are run inside the dedicated virtual environment `companion/.venv`:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Commands
- Run dashboard: `streamlit run src/ui/app.py`
- Run test suite: `pytest`
- Type checking: `mypy src`
