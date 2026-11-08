"""One-time Gmail sign-in. Run from the agent folder:

    python -m app.auth_gmail

Opens a browser, asks for read-only Gmail access, and saves token.json.
"""

import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

from app.config import get_settings
from app.providers.gmail_api import SCOPES


def main() -> int:
    settings = get_settings()
    credentials_file = Path(settings.gmail_credentials_file)
    token_file = Path(settings.gmail_token_file)

    if not credentials_file.exists():
        print(
            f"Missing {credentials_file}. Download your OAuth client (Desktop app) from\n"
            "Google Cloud Console > APIs & Services > Credentials, save it as\n"
            f"{credentials_file.resolve()}, then run this again. See PLAN.md section 9.",
            file=sys.stderr,
        )
        return 1

    flow = InstalledAppFlow.from_client_secrets_file(str(credentials_file), SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent")
    token_file.write_text(creds.to_json())
    print(f"Signed in. Read-only Gmail token saved to {token_file.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
