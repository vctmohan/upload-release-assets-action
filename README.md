# GitHub Action for Uploading Release Assets

## Developer Notes

The initial code for this repo is created by copying the source from
https://github.com/actions/typescript-action repository.

GitHub downloads each action run in a workflow during runtime and executes it
as a complete package of code before you can use workflow commands like `run`
to interact with the runner machine. This means you must include any package
dependencies required to run the JavaScript code. You'll need to check in the
toolkit `core` and `github` packages to your action's repository. That means,
we need to checking `node_modules` directory into the repo.

However, checking in your node_modules directory can cause problems. As an
alternative, you can use a tool called @vercel/ncc to compile your code and
modules into one file used for distribution. 

-  Install `vercel/ncc` by running this command in the terminal.
   `npm i -g @vercel/ncc`

-  Compile `index.js` file.
   `ncc build index.js --license licenses.txt`

   This will create a new `dist/index.js` file with your code and the compiled
   modules. You will also see an accompanying `dist/licenses.txt` file
   containing all the licenses of the `node_modules` you are using.

