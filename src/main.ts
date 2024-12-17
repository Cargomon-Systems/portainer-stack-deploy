import * as core from '@actions/core'
import axios from 'axios'
import { DeployStack, deployStack } from './deployStack'

function getInputs(): DeployStack {
  const portainerHost: string = core.getInput('portainer-host', {
    required: true
  })
  const username: string = core.getInput('username', {
    required: true
  })
  const password: string = core.getInput('password', {
    required: true
  })
  const swarmId: string = core.getInput('swarm-id', {
    required: false
  })
  const endpointId: string = core.getInput('endpoint-id', {
    required: false
  })
  const stackName: string = core.getInput('stack-name', {
    required: false
  })
  const stackDefinitionFile: string = core.getInput('stack-definition', {
    required: false
  })
  const templateVariables: string = core.getInput('template-variables', {
    required: false
  })
  const image: string = core.getInput('image', {
    required: false
  })
  const pruneStack: boolean = core.getBooleanInput('prune-stack', {
    required: false
  })
  const pullImage: boolean = core.getBooleanInput('pull-image', {
    required: false
  })
  const rejectUnauthorized: boolean =
    core.getBooleanInput('reject-unauthorized', {
      required: false
    }) == true
  const stacksFile: string = core.getInput('stacks-file', {
    required: false
  })
  const stacksFileRegistry: string = core.getInput('stacks-file-registry', {
    required: false
  })

  return {
    portainerHost,
    username,
    password,
    swarmId,
    endpointId: parseInt(endpointId) || 1,
    stackName,
    stackDefinitionFile: stackDefinitionFile ?? undefined,
    templateVariables: templateVariables ? JSON.parse(templateVariables) : undefined,
    stacksFile,
    stacksFileRegistry,
    image,
    pruneStack,
    pullImage,
    rejectUnauthorized
  }
}

// DeployStack
export async function run(): Promise<void> {
  try {
    const userInputs = getInputs()
    await deployStack(userInputs)
    core.info('✅ Deployment done')
  } catch (error) {
    core.info('⛔️ Something went wrong during deployment!')
    if (axios.isAxiosError(error) && error.response) {
      const {
        status,
        data,
        config: { url, method }
      } = error.response
      return core.setFailed(
        `AxiosError HTTP Status ${status} (${method} ${url}): ${JSON.stringify(data, null, 2)}`
      )
    } else {
      core.info(`error: ${JSON.stringify(error, null, 2)}`)
    }
    return core.setFailed(error as Error)
  }
}

run()
