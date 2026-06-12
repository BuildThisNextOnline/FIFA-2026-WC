"""
setup_github.py  --  One-shot GitHub deployment helper for WC2026 Tracker.

Reads credentials from github_config.json in the project root.
No typing required — just fill in the config file and double-click
deploy_to_github.bat.

Steps:
  1. Load config from github_config.json
  2. Check Git is installed
  3. Create the public GitHub repository via API
  4. Update README.md with your live Pages URL
  5. Push all code to GitHub (token removed from git config afterwards)
  6. Print the two Settings links to click on GitHub
"""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "github_config.json")

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def ok(msg):   print(f"  [OK]  {msg}")
def err(msg):  print(f"  [!!]  {msg}")
def info(msg): print(f"        {msg}")
def line():    print("  " + "-" * 56)

# ---------------------------------------------------------------------------
# Step 1 — load config
# ---------------------------------------------------------------------------

def load_config():
    line()
    print("  Step 1 of 5 — loading github_config.json")
    line()

    if not os.path.exists(CONFIG):
        err("github_config.json not found in the project folder.")
        info("Create it with your GitHub username, token, and repo name.")
        return None

    with open(CONFIG, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    username  = cfg.get("github_username", "").strip()
    token     = cfg.get("github_token",    "").strip()
    repo_name = cfg.get("repo_name",       "").strip()

    problems = []
    if not username or username == "YOUR_GITHUB_USERNAME":
        problems.append("github_username is not set")
    if not token or token.startswith("ghp_YOUR"):
        problems.append("github_token is not set (replace the placeholder with your real token)")
    if not repo_name:
        problems.append("repo_name is not set")

    if problems:
        err("github_config.json has placeholder values — please fill it in:")
        for p in problems:
            info(f"  - {p}")
        info("")
        info(f"  File location:  {CONFIG}")
        info("  Open it in Notepad, replace the placeholders, save, then re-run.")
        return None

    ok(f"Username:  {username}")
    ok(f"Repo name: {repo_name}")
    ok(f"Token:     {token[:8]}{'*' * (len(token) - 8)}")
    return username, token, repo_name

# ---------------------------------------------------------------------------
# Step 2 — check Git
# ---------------------------------------------------------------------------

def check_git():
    line()
    print("  Step 2 of 5 — checking Git is installed")
    line()
    try:
        r = subprocess.run(["git", "--version"], capture_output=True, text=True, check=True)
        ok(r.stdout.strip())
        return True
    except FileNotFoundError:
        err("Git is not installed or not on your PATH.")
        info("")
        info("Download and install Git from:  https://git-scm.com/download/win")
        info("During setup, keep all default options.")
        info("Then re-run deploy_to_github.bat")
        return False

# ---------------------------------------------------------------------------
# Step 3 — create GitHub repository
# ---------------------------------------------------------------------------

def create_repo(username, token, repo_name):
    line()
    print("  Step 3 of 5 — creating GitHub repository")
    line()

    payload = json.dumps({
        "name":        repo_name,
        "description": "FIFA World Cup 2026 probability tracker — Poisson + Dixon-Coles, Monte Carlo simulation",
        "private":     False,
        "auto_init":   False,
    }).encode()

    req = urllib.request.Request(
        "https://api.github.com/user/repos",
        data    = payload,
        headers = {
            "Authorization": f"token {token}",
            "Accept":        "application/vnd.github.v3+json",
            "Content-Type":  "application/json",
            "User-Agent":    "WC2026-Setup/1.0",
        },
        method  = "POST",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.load(resp)
        html_url = data["html_url"]
        ok(f"Repository created: {html_url}")
        return html_url

    except urllib.error.HTTPError as e:
        body    = e.read().decode(errors="replace")
        message = (json.loads(body).get("message", body)
                   if body.strip().startswith("{") else body)

        if e.code == 422 or "already exists" in message.lower():
            html_url = f"https://github.com/{username}/{repo_name}"
            ok(f"Repository already exists — using it: {html_url}")
            return html_url

        if e.code in (401, 403) or "Bad credentials" in message:
            err("GitHub rejected the token.")
            info("Check that:")
            info("  - The token in github_config.json is correct (no extra spaces)")
            info('  - The token has the "repo" scope enabled')
            info("  Create a new one at:  https://github.com/settings/tokens/new")
        else:
            err(f"GitHub API error {e.code}: {message}")
        return None

    except Exception as e:
        err(f"Network error: {e}")
        return None

# ---------------------------------------------------------------------------
# Step 4 — update README + push
# ---------------------------------------------------------------------------

def update_readme(username, repo_name):
    pages_url = f"https://{username}.github.io/{repo_name}/"
    readme    = os.path.join(ROOT, "README.md")

    try:
        with open(readme, "r", encoding="utf-8") as f:
            original = f.read()

        updated = re.sub(
            r"https://[a-zA-Z0-9_-]+\.github\.io/[^\s)\]\"]+",
            pages_url,
            original,
        )

        if updated != original:
            with open(readme, "w", encoding="utf-8") as f:
                f.write(updated)
            ok(f"README updated: {pages_url}")
        else:
            ok("README URL already correct — no change needed")

    except Exception as e:
        info(f"(README update skipped: {e})")

    return pages_url

def push_code(username, token, repo_name):
    line()
    print("  Step 4 of 5 — pushing code to GitHub")
    line()

    auth_url  = f"https://{token}@github.com/{username}/{repo_name}.git"
    clean_url = f"https://github.com/{username}/{repo_name}.git"

    # Set or update the remote
    remotes = subprocess.run(["git", "remote"], capture_output=True, text=True).stdout
    if "origin" in remotes:
        subprocess.run(["git", "remote", "set-url", "origin", auth_url], check=True)
    else:
        subprocess.run(["git", "remote", "add", "origin", auth_url], check=True)

    # Commit README change if needed
    subprocess.run(["git", "add", "README.md"])
    if subprocess.run(["git", "diff", "--staged", "--quiet"]).returncode != 0:
        subprocess.run(["git", "commit", "-m", "chore: update README with live site URL"], check=True)

    info("Uploading — this may take a few seconds…")
    result = subprocess.run(["git", "push", "-u", "origin", "main"])

    # Always strip token from config, whether push succeeded or not
    subprocess.run(["git", "remote", "set-url", "origin", clean_url])
    ok("Token removed from git config")

    if result.returncode != 0:
        err("Push failed.")
        info("")
        info("  The most common cause is a missing token scope.")
        info("  GitHub requires TWO scopes to push workflow files:")
        info("")
        info("    repo      — push code")
        info("    workflow  — push files inside .github/workflows/")
        info("")
        info("  Fix: generate a new token at")
        info("    https://github.com/settings/tokens/new")
        info("  tick BOTH 'repo' and 'workflow', copy the new token,")
        info("  update github_config.json, and re-run deploy_to_github.bat.")
        info("  (The GitHub repo already exists — it will reuse it.)")
        return False

    ok("All code uploaded to GitHub")
    return True

# ---------------------------------------------------------------------------
# Step 5 — next steps
# ---------------------------------------------------------------------------

def print_next_steps(html_url, pages_url):
    line()
    print("  Step 5 of 5 — two clicks on GitHub to go live")
    line()
    info("")
    info("  A)  Enable the public website:")
    info(f"      {html_url}/settings/pages")
    info("      Set:  Source  →  GitHub Actions  →  Save")
    info("")
    info("  B)  Allow automatic score updates to write back to the repo:")
    info(f"      {html_url}/settings/actions")
    info("      Set:  Workflow permissions  →  Read and write permissions  →  Save")
    info("")
    info("  After both saves your site will be live within ~2 minutes at:")
    info(f"      {pages_url}")
    info("")
    info("  Scores then refresh automatically every 2 hours.")
    info("  You never need to run anything again.")
    info("")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print()
    print("  =====================================================")
    print("   World Cup 2026 Probability Tracker")
    print("   GitHub deployment — reading github_config.json")
    print("  =====================================================")
    print()

    result = load_config()
    if result is None:
        sys.exit(1)
    username, token, repo_name = result

    if not check_git():
        sys.exit(1)

    html_url = create_repo(username, token, repo_name)
    if not html_url:
        sys.exit(1)

    pages_url = update_readme(username, repo_name)

    if not push_code(username, token, repo_name):
        sys.exit(1)

    print_next_steps(html_url, pages_url)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n  Cancelled.")
        sys.exit(0)
    finally:
        input("  Press Enter to close this window.")
