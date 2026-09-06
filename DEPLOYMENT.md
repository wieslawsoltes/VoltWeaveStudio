# VoltWeave Studio deployment

Application: https://wieslawsoltes.github.io/VoltWeaveStudio/

Standalone edition: https://wieslawsoltes.github.io/VoltWeaveStudio/VoltWeave-Standalone.html

## Local development

```sh
git clone https://github.com/wieslawsoltes/VoltWeaveStudio.git
cd VoltWeaveStudio
npm start
```

Open http://localhost:8080. Node.js 20 or newer is required. There are no npm dependencies to install.

## Continuous delivery

`.github/workflows/pages.yml` validates each pull request and push to `main`. Publishing runs only for `main` after syntax checks, all core/Worker tests, and generation of the static distribution have succeeded. Official GitHub Actions are pinned to commit SHAs. Deployment uses the `github-pages` environment and the built-in short-lived Actions token; no personal token is required for an already-enabled Pages site.

The generated `_site/` contains an explicit allowlist: the HTML/CSS application, native JavaScript modules and Worker, example projects, regenerated standalone edition, license, and operator/architecture documentation. Repository automation and tests are not published. A `.nojekyll` marker prevents source transformation. All application URLs are relative, including the module Worker URL, so the repository subpath is supported without patching the engine.

`build-info.json` records the source commit, version, and SHA-256/size of each public asset. After deployment, the workflow retrieves that manifest and every listed asset over HTTPS. It verifies the expected commit and exact content, retrying while the CDN updates. This verifies publication integrity, not physical-GPU performance or browser workflows.

## Reproduce the package

Node.js and Python 3 are sufficient:

```sh
npm run check
npm test
npm run build
python3 -m http.server 8080 --directory _site
```

In another terminal, verify the locally built distribution:

```sh
npm run verify:pages -- http://localhost:8080/
```

The local commit marker is `local`. To verify an Actions deployment, set `GITHUB_SHA` to its full source commit and pass the site URL to the same command. `_site/` is ignored by Git and can be regenerated at any time. The generated standalone HTML is also included in the repository for convenient download.

## Repository settings

For the custom artifact workflow, Pages must be enabled with **Settings > Pages > Build and deployment > Source: GitHub Actions**. The deploy job reports an actionable error when Pages or its environment is not configured. Do not add an administrator token to this workflow. Pull-request runs never deploy.

The initial `gh-pages` branch is a tested static snapshot retained from initial publication. The continuous-delivery workflow publishes artifacts from `main`; it does not update that snapshot branch. Use the Actions publishing source for ongoing deployments.
