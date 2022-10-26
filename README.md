# GitHub Action for Uploading Release Assets

## Developer Notes

The initial code for this repo is created by copying the source from
https://github.com/actions/typescript-action repository.

GitHub downloads each action run in a workflow during runtime and executes it
as a complete package of code before user can use workflow commands like `run`
to interact with the runner machine. This means you must include any package
dependencies required to run the JavaScript code. You'll need to check in the
toolkit `core` and `github` packages to your action's repository, which means
the `node_modules` directory should be included in the repo.

However, checking in your node_modules directory can cause problems. As an
alternative, you can use a tool called @vercel/ncc to compile your code and
modules into one file used for distribution. This package.json already
includes the ncc packages and makes of it. Look at the package script and the
before link for details.

[Creating a JavaScript action - GitHub Docs](https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action)

## Update Procedure

-  Update the code from `src` folder
-  But version in `package.json`
-  Create `CHANGELOG.md` entry if change log file is used
-  npm run all
-  git commit -m "..."
-  git tag -m <version> <version>
-  git push --follow-tags
-  Check if new version is publised in the releases
