import * as core from '@actions/core'
import * as github from '@actions/github'
import {Octokit} from '@octokit/rest'
import {Endpoints} from '@octokit/types'
import * as glob from 'glob'
import * as path from 'path'
import * as fs from 'fs'

type ReleaseByTagRespType =
  Endpoints['GET /repos/{owner}/{repo}/releases/tags/{tag}']['response']
type CreateReleaseRespType =
  Endpoints['POST /repos/{owner}/{repo}/releases']['response']

function getContext(): {owner: string; repo: string} {
  const repo_name = core.getInput('repo_name')
  // If we're not targeting a foreign repository, we can just
  // return immediately and don't have to do extra work.
  if (!repo_name) {
    return github.context.repo
  }
  const owner = repo_name.slice(0, repo_name.indexOf('/'))
  if (!owner) {
    throw new Error(`Could not extract 'owner' from 'repo_name': ${repo_name}.`)
  }
  const repo = repo_name.slice(repo_name.indexOf('/') + 1)
  if (!repo) {
    throw new Error(`Could not extract 'repo' from 'repo_name': ${repo_name}.`)
  }
  return {
    owner,
    repo
  }
}

const getChangeLog = (): string => {
  return 'Change Log'
}

const createReleaseDescription = (
  body: string | undefined,
  title: string
): string => {
  if (body === undefined || body === '') {
    return `${title}\n${getChangeLog()}\n`
  } else {
    return body
  }
}

const createReleaseByTag = async (
  owner: string,
  repo: string,
  tag: string,
  prerelease: boolean,
  release_name: string,
  body: string | undefined,
  title: string,
  octokit: Octokit
): Promise<CreateReleaseRespType> => {
  return await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: tag,
    prerelease,
    name: release_name,
    body: createReleaseDescription(body, title)
  })
}

const getReleaseByTag = async (
  owner: string,
  repo: string,
  tag: string,
  prerelease: boolean,
  release_name: string,
  body: string | undefined,
  title: string,
  octokit: Octokit
): Promise<ReleaseByTagRespType | CreateReleaseRespType> => {
  try {
    core.debug(`Getting release by tag ${tag}.`)
    return await octokit.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag
    })
  } catch (error: any) {
    // If this returns 404, we need to create the release first.
    if (error.status === 404) {
      core.debug(
        `Release for tag ${tag} doesn't exist yet so we'll create it now.`
      )
      return await createReleaseByTag(
        owner,
        repo,
        tag,
        prerelease,
        release_name,
        body,
        title,
        octokit
      )
    } else {
      throw error
    }
  }
}

interface Asset {
  src: string
  name: string
}

const generateFileList = (
  tag: string,
  file: string,
  globOn: boolean
): Asset[] => {
  if (globOn) {
    return glob.sync(file).map(f => {
      return {
        src: f,
        name: path.basename(f)
      } as Asset
    })
  } else {
    const assetNameInput = core.getInput('asset_name')
    const assetName =
      assetNameInput !== ''
        ? assetNameInput.replace(/\$tag/g, tag)
        : path.basename(file)
    return [
      {
        src: file,
        name: assetName
      }
    ]
  }
}

const uploadFileListToRelease = async (
  release: ReleaseByTagRespType | CreateReleaseRespType,
  owner: string,
  repo: string,
  tag: string,
  assets: Asset[],
  overwrite: boolean,
  octokit: Octokit
): Promise<void> => {
  if (assets.length === 0) {
    core.setFailed('No matching files found.')
  }

  assets.map(asset => {
    const assetDownloadUrl = checkAndUploadFileToRelease(
      release,
      owner,
      repo,
      tag,
      asset,
      overwrite,
      octokit
    )
    if (assetDownloadUrl !== undefined) {
      core.setOutput('browser_download_url', assetDownloadUrl)
    } else {
      core.setFailed(`asset upload failed`)
    }
  })
}

const checkAndUploadFileToRelease = async (
  release: ReleaseByTagRespType | CreateReleaseRespType,
  owner: string,
  repo: string,
  tag: string,
  asset: Asset,
  overwrite: boolean,
  octokit: Octokit
): Promise<string | undefined> => {
  const stat = fs.statSync(asset.src)
  if (!stat.isFile()) {
    core.debug(`Skipping ${asset.src}, since its not a file`)
    return
  }

  const currAssetDownloadUrl = await assetDownloadUrlIfCurrentNotOverWritable(
    release,
    owner,
    repo,
    tag,
    asset.name,
    overwrite,
    octokit
  )
  if (currAssetDownloadUrl !== undefined) return currAssetDownloadUrl

  const newAssetDownloadUrl = await uploadFileToRelease(
    release,
    owner,
    repo,
    asset.src,
    asset.name,
    octokit
  )
  return newAssetDownloadUrl
}

const assetDownloadUrlIfCurrentNotOverWritable = async (
  release: ReleaseByTagRespType | CreateReleaseRespType,
  owner: string,
  repo: string,
  tag: string,
  assetName: string,
  overwrite: boolean,
  octokit: Octokit
): Promise<string | undefined> => {
  const assets = await octokit.paginate(
    octokit.rest.repos.listReleaseAssets,
    {
      owner,
      repo,
      release_id: release.data.id
    }
  )
  const duplicateAsset = assets.find(a => a.name === assetName)
  if (duplicateAsset !== undefined) {
    core.debug(`An asset called ${assetName} already exists in release ${tag}.`)
    if (overwrite) {
      core.debug(`Overwrite is true. Deleting current asset.`)
      await octokit.rest.repos.deleteReleaseAsset({
        owner,
        repo,
        asset_id: duplicateAsset.id
      })
    } else {
      core.setFailed(`Overwrite is false. Returning existing asset URL`)
      return duplicateAsset.browser_download_url
    }
  } else {
    core.debug(
      `No pre-existing asset called ${assetName} found in release ${tag}.`
    )
  }
}

const uploadFileToRelease = async (
  release: ReleaseByTagRespType | CreateReleaseRespType,
  owner: string,
  repo: string,
  assetName: string,
  filePath: string,
  octokit: Octokit
): Promise<string | undefined> => {
  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const fileBytes = fs.readFileSync(filePath)

  const uploadResp = octokit.request({
    method: 'POST',
    url: release.data.upload_url,
    headers: {
      'content-type': 'binary/octet-stream',
      'content-length': fileSize
    },
    data: fileBytes,
    name: assetName
  })

  return (await uploadResp).data.browser_download_url
}

const getReleaseTitle = (tag: string): string => {
  const title = core.getInput('title')
  if (title !== '') {
    return title
  } else {
    return tag
  }
}

const run = async (): Promise<void> => {
  try {
    // Get the inputs from the workflow file
    // https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    const token = core.getInput('repo_token', {required: true})
    const file = core.getInput('file', {required: true})
    const tag = core
      .getInput('tag', {required: true})
      .replace('refs/tags/', '')
      .replace('refs/heads/', '')

    const globOn = core.getInput('glob_on') === 'true' ? true : false
    const overwrite = core.getInput('overwrite') === 'true' ? true : false
    const prerelease = core.getInput('prerelease') === 'true' ? true : false
    const release_name = core.getInput('release_name')
    const body = core.getInput('body')
    const title = getReleaseTitle(tag)

    const {owner, repo} = getContext()

    const release = await getReleaseByTag(
      owner,
      repo,
      tag,
      prerelease,
      release_name,
      body,
      title,
      octokit
    )

    await uploadFileListToRelease(
      release,
      owner,
      repo,
      tag,
      generateFileList(tag, file, globOn),
      overwrite,
      octokit
    )
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

run()
