import { PortainerApi } from './api'
import path from 'path'
import fs from 'fs'
import Handlebars from 'handlebars'
import * as core from '@actions/core'
import * as yaml from 'js-yaml'

type DeployStack = {
  portainerHost: string
  username: string
  password: string
  swarmId?: string
  endpointId: number
  stackName?: string
  stackDefinitionFile?: string
  templateVariables?: object
  stacksFile?: string
  image?: string
  pruneStack?: boolean
  pullImage?: boolean
  rejectUnauthorized?: boolean
}

enum StackType {
  SWARM = 1,
  COMPOSE = 2
}

type StacksFileDeployItem = {
  stack: string
  path: string
  image?: string
  version?: string
  template: Record<string, string>
}

type StacksFileDeployableItem = {
  stack: string
  path: string
  image: string
  template: Record<string, string>
}

type StacksFile = {
  registry: string
  deploy: StacksFileDeployItem[]
}

type CtrfSingleTestReport = {
  name: string
  status: 'passed' | 'failed'
  duration: number
  message: string
}

type CtrfReport = {
  results: {
    tool: {
      name: 'portainer-deploy-stacks'
    }
    summary: {
      tests: number
      passed: number
      failed: number
      pending: number
      skipped: number
      other: number
      start: number
      stop: number
    }
    tests: CtrfSingleTestReport[]
  }
}

function readStacksFile(stacksFilePath: string): StacksFileDeployableItem[] {
  // Read the YAML file and parse it
  function parseYamlFile(filePath: string): StacksFile {
    const fileContents = fs.readFileSync(filePath, 'utf8')
    return yaml.load(fileContents) as StacksFile
  }

  // Process the YAML content into the desired output format
  function processYaml(config: StacksFile): StacksFileDeployableItem[] {
    return config.deploy.map(item => {
      const imageName = item.image || item.stack
      const dockerImage = `${config.registry}/${imageName}:${item.version || 'latest'}`

      return {
        stack: item.stack,
        path: item.path,
        image: dockerImage,
        template: item.template
      }
    })
  }

  const yamlConfig = parseYamlFile(stacksFilePath)
  const result = processYaml(yamlConfig)
  return result
}

function generateNewStackDefinition(
  stackDefinitionFile?: string,
  templateVariables?: object,
  image?: string
): string | undefined {
  if (!stackDefinitionFile) {
    core.info(`No stack definition file provided. Will not update stack definition.`)
    return undefined
  }

  const stackDefFilePath = path.join(
    (process.env.GITHUB_WORKSPACE as string) || '.',
    stackDefinitionFile
  )

  core.info(`Reading stack definition file from ${stackDefFilePath}`)
  let stackDefinition = fs.readFileSync(stackDefFilePath, 'utf8')
  if (!stackDefinition) {
    throw new Error(`Could not find stack-definition file: ${stackDefFilePath}`)
  }

  if (templateVariables) {
    core.info(`Applying template variables for keys: ${Object.keys(templateVariables)}`)
    stackDefinition = Handlebars.compile(stackDefinition)(templateVariables)
  }

  if (!image) {
    core.info(`No new image provided. Will use image in stack definition.`)
    return stackDefinition
  }

  const imageWithoutTag = image.substring(0, image.indexOf(':'))
  core.info(`Inserting image ${image} into the stack definition`)
  return stackDefinition.replace(new RegExp(`${imageWithoutTag}(:.*)?\n`), `${image}\n`)
}

async function deployStack({
  portainerHost,
  username,
  password,
  swarmId,
  endpointId,
  stackName,
  stackDefinitionFile,
  templateVariables,
  stacksFile,
  image,
  pullImage,
  pruneStack,
  rejectUnauthorized
}: DeployStack): Promise<void> {
  const startTime = new Date()
  const portainerApi = new PortainerApi(portainerHost, rejectUnauthorized)

  core.info('Logging in to Portainer instance...')
  await portainerApi.login({
    username,
    password
  })
  const allStacks = await portainerApi.getStacks()

  const deploySingleStack = async (
    currentStackName: string,
    stackDefinitionFilePath: string,
    stackTemplateVariables: object,
    stackImage: string
  ): Promise<void> => {
    const stackDefinitionToDeploy = generateNewStackDefinition(
      stackDefinitionFilePath,
      stackTemplateVariables,
      stackImage
    )

    if (stackDefinitionToDeploy) {
      core.debug(stackDefinitionToDeploy)
    }

    const existingStack = allStacks.find(s => {
      return s.Name === currentStackName && s.EndpointId === endpointId
    })

    if (existingStack) {
      core.info(`Found existing stack with name: ${currentStackName}`)
      core.info('Updating existing stack...')
      await portainerApi.updateStack(
        existingStack.Id,
        {
          endpointId: existingStack.EndpointId
        },
        {
          env: existingStack.Env,
          stackFileContent: stackDefinitionToDeploy,
          prune: pruneStack ?? false,
          pullImage: pullImage ?? false
        }
      )
      core.info('Successfully updated existing stack')
    } else {
      if (!stackDefinitionToDeploy) {
        throw new Error(
          `Stack with name ${currentStackName} does not exist and no stack definition file was provided.`
        )
      }
      core.info('Deploying new stack...')
      await portainerApi.createStack(
        {
          type: swarmId ? StackType.SWARM : StackType.COMPOSE,
          method: 'string',
          endpointId
        },
        {
          name: currentStackName,
          stackFileContent: stackDefinitionToDeploy,
          swarmID: swarmId ? swarmId : undefined
        }
      )
      core.info(`Successfully created new stack with name: ${currentStackName}`)
    }
  }

  const stacksResults: CtrfSingleTestReport[] = []
  if (stacksFile != null && stacksFile.length > 0) {
    const stacks = readStacksFile(stacksFile)
    for (const stack of stacks) {
      const singleStackResult: CtrfSingleTestReport = {
        name: stack.stack,
        status: 'passed',
        duration: 0,
        message: 'deployed Successfully'
      }
      const stackStartTime = new Date()
      try {
        await deploySingleStack(stack.stack, stack.path, stack.template, stack.image || '')
      } catch (err) {
        singleStackResult.status = 'failed'
        singleStackResult.message = JSON.stringify(err)
      }
      const stackEndTime = new Date()
      singleStackResult.duration = stackEndTime.getTime() - stackStartTime.getTime()
    }
  } else if (stackName && stackDefinitionFile && templateVariables && image) {
    const singleStackResult: CtrfSingleTestReport = {
      name: stackName,
      status: 'passed',
      duration: 0,
      message: 'deployed Successfully'
    }
    const stackStartTime = new Date()
    try {
      await deploySingleStack(stackName, stackDefinitionFile, templateVariables, image)
    } catch (err) {
      singleStackResult.status = 'failed'
      singleStackResult.message = JSON.stringify(err)
    }
    const stackEndTime = new Date()
    singleStackResult.duration = stackEndTime.getTime() - stackStartTime.getTime()
  }

  const endTime = new Date()
  const report: CtrfReport = {
    results: {
      tool: {
        name: 'portainer-deploy-stacks'
      },
      summary: {
        tests: stacksResults.length,
        passed: stacksResults.filter(r => r.status === 'passed').length,
        failed: stacksResults.filter(r => r.status === 'failed').length,
        pending: 0,
        skipped: 0,
        other: 0,
        start: startTime.getTime(),
        stop: endTime.getTime()
      },
      tests: stacksResults
    }
  }

  fs.writeFileSync('portainer-deploy-stacks-report.json', JSON.stringify(report, null, 2))

  const hasErrored = report.results.summary.failed > 0
  if (hasErrored) {
    throw new Error('One or more stacks failed to deploy')
  }
}

export { deployStack, DeployStack }
