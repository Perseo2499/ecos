# Code signing policy

Ecos is a free and open-source desktop application (GPL-3.0-or-later) that turns Instagram and Facebook posts into a WordPress blog and helps manage the website.
Source code: <https://github.com/Perseo2499/ecos> · Spanish version: [politica-firma.md](politica-firma.md)

## Attribution

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Windows releases of Ecos published at <https://github.com/Perseo2499/ecos/releases> are signed with a certificate issued by SignPath Foundation, once the project has been accepted into the program. Releases published before that point are unsigned, and builds you compile yourself are never signed with that certificate.

## What is signed

Only the Windows binaries that are produced by the official build of this repository:

- `Ecos-Setup-<version>.exe` (NSIS installer) and the `Ecos.exe` inside it.
- `Ecos-<version>-portable.exe` (portable build).

Third-party binaries bundled in the package (for example FFmpeg) are not re-signed by this project, except where they are part of the signed container as described by the SignPath artifact configuration.

## Roles

| Role | Who |
|---|---|
| Committers and reviewers | [Perseo2499](https://github.com/Perseo2499) (and any contributor whose change is reviewed and merged by Perseo2499) |
| Approvers (approve each signing request) | [Perseo2499](https://github.com/Perseo2499) |

Pull requests from outside contributors are reviewed by a committer before merge. Every signing request needs manual approval by an approver. All team members use multi-factor authentication on GitHub and SignPath.

## Build and release process

- Every signed release is built from this repository, on GitHub-hosted runners, by the GitHub Actions workflow [`.github/workflows/build.yml`](../.github/workflows/build.yml). No signed binary is built or uploaded by hand.
- The workflow compiles the app with `electron-builder` (unsigned), uploads the executables as a GitHub Actions artifact and submits them to SignPath using the official `signpath/github-action-submit-signing-request` action. SignPath verifies that the artifact comes from this repository and workflow run, then signs it after approval.
- The signed files replace the unsigned ones; the update metadata (`latest.yml`) is regenerated with the hash and size of the signed installer, and the release is published on GitHub Releases.
- The version number is set in `package.json` and each release is tagged `v<version>`.

## Commitments

- This project does not include malware or potentially unwanted programs, and does not change system settings (registry, security settings, startup entries and similar) without the user's permission. The installer only installs Ecos and its shortcuts; the app only stores its own data in the user's profile.
- Ecos is released under an OSI-approved open-source license (GPL-3.0-or-later). Its dependencies and their licenses are listed in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
- Signing keys are held by SignPath; the project never has access to the private key.
- If a signed release is found to be malicious or compromised, the certificate usage will be reported to SignPath Foundation, the release removed and a fixed version published.

## Privacy policy

Ecos does not collect, store or send any personal data to its developers. It has no telemetry, no analytics and no crash reporting service.

The app only communicates with the services that **you** connect or choose to use, and only to do what you ask:

| Service | When | What is sent |
|---|---|---|
| Your WordPress site (self-hosted or WordPress.com) | When you connect it, read, publish or manage the site | Your login/authorization token, posts, pages, images and settings you work with |
| Meta (Instagram / Facebook, Graph API) | When you connect your account and import or share posts | The authorization token and the requests needed to read your posts (and publish a share, if you enable it) |
| Google Photos (Picker API) | If you import photos from it | The authorization token and the selection requests |
| The AI provider you choose (for example Anthropic, OpenAI, Google or a compatible local/custom service) | Only if you enable AI features and paste your own key | The text or images you ask it to process and your own API key |
| GitHub (github.com) | To check for new Ecos versions and download updates | A normal HTTPS request for the release metadata and installer; GitHub sees your IP address as with any web request |
| Real-ESRGAN release on GitHub | Only if you enable local photo enhancement | A download of the engine; processing is done on your computer |

Credentials and keys are stored on your computer in the app's data folder, protected with the operating system's secure storage when available. The error log stays on your computer and does not contain passwords or keys; it is only shared if you copy and send it yourself.

Ecos sends nothing to the developers. Third-party services have their own privacy policies, which apply to the data you send them.

## Contact and reporting

Open an issue at <https://github.com/Perseo2499/ecos/issues> for questions, abuse reports or security concerns.
