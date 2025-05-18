import axios from 'axios'
import * as https from 'node:https'

type EnvVariables = Array<{
  name: string
  value: string
}>

type EndpointId = number

type StackData = {
  Id: number
  Name: string
  EndpointId: EndpointId
  Env: EnvVariables
}

type CreateStackParams = { type: number; method: string; endpointId: EndpointId }
type CreateStackBody = { name: string; stackFileContent: string; swarmID?: string }
type UpdateStackParams = { endpointId: EndpointId }
type UpdateStackBody = {
  env: EnvVariables
  stackFileContent?: string
  prune: boolean
  pullImage: boolean
}

export class PortainerApi {
  private axiosInstance

  constructor(host: string, rejectUnauthorized = true) {
    this.axiosInstance = axios.create({
      baseURL: `${host}/api`,
      httpsAgent:
        rejectUnauthorized === false
          ? new https.Agent({
              rejectUnauthorized
            })
          : undefined
    })
  }

  async login({ username, password }: { username: string; password: string }): Promise<void> {
    const { data } = await this.axiosInstance.post<{ jwt: string }>('/auth', {
      username,
      password
    })
    this.axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${data.jwt}`
  }

  async logout(): Promise<void> {
    await this.axiosInstance.post('/auth/logout')
    this.axiosInstance.defaults.headers.common['Authorization'] = ''
  }

  async getStacks(): Promise<StackData[]> {
    const { data } = await this.axiosInstance.get<StackData[]>('/stacks')
    return data
  }

  async createStack(params: CreateStackParams, body: CreateStackBody): Promise<void> {
    await this.axiosInstance.post('/stacks/create/swarm/string', body, { params })
    //Todo: create path dynamically based on type and method in params
  }

  async updateStack(id: number, params: UpdateStackParams, body: UpdateStackBody): Promise<void> {
    await this.axiosInstance.put(`/stacks/${id}`, body, { params })
  }
}
