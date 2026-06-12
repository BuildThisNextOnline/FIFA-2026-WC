"""
setup_github.py  --  One-shot GitHub deployment helper for WC2026 Tracker.

What this script does (fully automated, nothing manual):
  1. Checks Git is installed
  2. Asks for your GitHub username, a Personal Access Token, and a repo name
  3. Creates the public GitHub repository via the GitHub API
  4. Updates the live-site URL in README.md to match your username/repo
  5. Pushes all code to GitHub
  6. Cleans the token out of the git config (security hygiene)
  7. Prints exact links to the two Settings pages you need to click

Run via:  deploy_to_github.bat   (in the project root folder)
"""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def banner(msg):
    print()
    print("  " + "-" * 56)
    print(f"  {msg}")
    print("  " + "-" * 56)

def ok(msg):   print(f"  OK  {msg}")
def err(msg):  print(f"  !!  {msg}")
def info(msg): print(f"      {msg}")

def ask(prompt, default=None):
    suffix = f" [{default}]" if default else ""
    while True:
        val = input(f"\n  {prompt}{suffix}: ").strip()
        if val:
            return val
        if default:
            return default
        print("  (this field is required — please type a value)")

# ---------------------------------------------------------------------------
# Step 1 — check Git
# ---------------------------------------------------------------------------

def check_git():
    banner("Step 1 of 5 — checking Git is installed")
    try:
        r = subprocess.run(["git", "--version"], capture_output=True, text=True, check=True)
        ok(r.stdout.strip())
        return True
    except FileNotFoundError:
        err("Git is not installed or not on your PATH.")
        info("")
        info("Fix:  download and install Git from  https://git-scm.com/download/win")
        info("      During setup tick  'Git from the command line and also from")
        info("      3rd-party software'  (the default option).")
        info("      Then re-run deploy_to_github.bat")
        return False

# ---------------------------------------------------------------------------
# Step 2 — collect credentials
# ---------------------------------------------------------------------------

def collect_credentials():
    banner("Step 2 of 5 — GitHub credentials")
    info("")
    info("You need a GitHub Personal Access Token (PAT) to let this script")
    info("create the repository on your behalf.")
    info("")
    info("How to get a PAT (takes about 60 seconds):")
    info("  1. Open this URL in your browser:")
    info("       https://github.com/settings/tokens/new")
    info("  2. Note name:   WC2026 deploy")
    info("  3. Expiration:  90 days")
    info('  4. Scopes:      tick the top-level "repo" checkbox')
    info("  5. Scroll down and click  'Generate token'")
    info("  6. COPY the token now — GitHub only shows it once.")
    info("")

    username  = ask("Your GitHub username  (e.g. johndoe)")
    token     = ask("Your PAT              (starts with ghp_...)")
    repo_name = ask("Repository name", "worldcup-2026-probabilities")

    return username, token, repo_name

# ---------------------------------------------------------------------------
# Step 3 — create GitHub repository
# ---------------------------------------------------------------------------

def create_repo(username, token, repo_name):
    banner("Step 3 of 5 — creating GitHub repository")

    url     = "https://api.github.com/user/repos"
    payload = json.dumps({
        "name":        repo_name,
        "description": "FIFA World Cup 2026 probability tracker — Poisson + Dixon-Coles, Monte Carlo simulation",
        "private":     False,
        "auto_init":   False,
    }).encode()

    req = urllib.request.Request(
        url,
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
        html_url  = data["html_url"]
        clone_url = data["clone_url"]
        ok(f"Repository created: {html_url}")
        return html_url, clone_url

    except urllib.error.HTTPError as e:
        body    = e.read().decode(errors="replace")
        message = json.loads(body).get("message", body) if body.startswith("{") else body

        if "already exists" in message.lower():
            html_url  = f"https://github.com/{username}/{repo_name}"
            clone_url = f"https://github.com/{username}/{repo_name}.git"
            ok(f"Repository already exists — using it: {html_url}")
            return html_url, clone_url

        if "Bad credentials" in message or e.code == 401:
            err("GitHub rejected the token — it may be wrong or missing the 'repo' scope.")
            info("Create a new PAT at  https://github.com/settings/tokens/new")
            info("and re-run deploy_to_github.bat")
        else:
            err(f"GitHub API error ({e.code}): {message}")

        return None, None

    except Exception as e:
        err(f"Network error: {e}")
        return None, None

# ---------------------------------------------------------------------------
# Step 4 — update README + push
# ---------------------------------------------------------------------------

def update_readme(username, repo_name):
    root      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    readme    = os.path.join(root, "README.md")
    pages_url = f"https://{username}.github.io/{repo_name}/"

    try:
        with open(readme, "r", encoding="utf-8") as f:
            content = f.read()

        updated = re.sub(
            r"https://[a-zA-Z0-9_-]+\.github\.io/[^\s)\]]+",
            pages_url,
            content,
        )

        if updated != content:
            with open(readme, "w", encoding="utf-8") as f:
                f.write(updated)
            ok(f"README updated with your Pages URL: {pages_url}")
        else:
            ok("README already has the correct URL (or no URL placeholder found)")

        return pages_url

    except Exception as e:
        info(f"(could not update README: {e} — continuing anyway)")
        return pages_url

def push_to_github(username, token, repo_name):
    banner("Step 4 of 5 — pushing code to GitHub")

    # Embed token in URL for this push, then remove it afterwards
    auth_url  = f"https://{token}@github.com/{username}/{repo_name}.git"
    clean_url = f"https://github.com/{username}/{repo_name}.git"

    # Configure remote
    remotes = subprocess.run(["git", "remote"], capture_output=True, text=True).stdout
    if "origin" in remotes:
        subprocess.run(["git", "remote", "set-url", "origin", auth_url], check=True)
    else:
        subprocess.run(["git", "remote", "add", "origin", auth_url], check=True)

    # Stage README if the update changed it
    subprocess.run(["git", "add", "README.md"])
    staged = subprocess.run(["git", "diff", "--staged", "--quiet"])
    if staged.returncode != 0:
        subprocess.run(["git", "commit", "-m", "chore: update README with live site URL"], check=True)

    # Push
    info("Uploading — this may take a few seconds...")
    result = subprocess.run(["git", "push", "-u", "origin", "main"])

    # Always clean the token from git config regardless of outcome
    subprocess.run(["git", "remote", "set-url", "origin", clean_url])

    if result.returncode != 0:
        err("Push failed. Most likely causes:")
        info("  - The PAT does not have the 'repo' scope")
        info("  - You mistyped the username or token")
        info("  - The repository name already exists under a different account")
        info("")
        info("Fix the issue above and re-run deploy_to_github.bat")
        return False

    ok("Code uploaded to GitHub")
    return True

# ---------------------------------------------------------------------------
# Step 5 — print final instructions
# ---------------------------------------------------------------------------

def print_next_steps(html_url, pages_url):
    banner("Step 5 of 5 — two settings to click on GitHub")
    info("")
    info("The code is on GitHub. Now enable the two automatic features:")
    info("")
    info("  A) Make the site publicly visible:")
    info(f"     Open:  {html_url}/settings/pages")
    info("     Set:   Source  →  GitHub Actions  →  Save")
    info("")
    info("  B) Allow the score-updater to write back to the repo:")
    info(f"     Open:  {html_url}/settings/actions")
    info("     Set:   Workflow permissions  →  Read and write permissions  →  Save")
    info("")
    info("  Done? Your site will be live at:")
    info(f"     {pages_url}")
    info("")
    info("  The first deploy runs automatically within ~2 minutes of saving.")
    info("  After that, scores refresh every 2 hours without any action from you.")
    info("")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print()
    print("  =====================================================")
    print("   World Cup 2026 Probability Tracker")
    print("   GitHub deployment helper")
    print("  =====================================================")

    if not check_git():
        input("\n  Press Enter to exit.")
        sys.exit(1)

    username, token, repo_name = collect_credentials()

    html_url, clone_url = create_repo(username, token, repo_name)
    if not html_url:
        input("\n  Press Enter to exit.")
        sys.exit(1)

    pages_url = update_readme(username, repo_name)

    success = push_to_github(username, token, repo_name)
    if not success:
        input("\n  Press Enter to exit.")
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
