import { createPool } from 'generic-pool'
import { Context, isNullable, Logger, Schema } from 'koishi'
import { createClient, RedisClientOptions, RedisClientType } from 'redis'
import Cache from '@koishijs/cache'

class RedisCache extends Cache {
  private logger = new Logger('redis')

  private pool = createPool({
    async create() {
      const client = createClient(this.config)
      await client.connect()
      return client as RedisClientType
    },
    async destroy(client) {
      await client.disconnect()
    },
  })

  constructor(ctx: Context, private config: RedisCache.Config) {
    super(ctx)
  }

  private getRedisKey(table: string, key: string) {
    return `${this.config.prefix}${table}:${key}`
  }

  private encode(data: any): string {
    return JSON.stringify(data)
  }

  private decode(record: string): any {
    return JSON.parse(record)
  }

  private async doInPool(action: (client: RedisClientType) => Promise<any>, errActionMessage = 'perform unknown action') {
    let client: RedisClientType
    try {
      client = await this.pool.acquire()
    } catch (e) {
      this.logger.warn(`Failed to create Redis connection: ${e.toString()}`)
      return
    }
    if (!client) {
      this.logger.warn(`Failed to create Redis connection: Got empty client`)
      return
    }
    try {
      return await action(client)
    } catch (e) {
      this.logger.warn(`Failed to ${errActionMessage}: ${e.toString()}`)
      return
    } finally {
      await this.pool.release(client)
    }
  }

  async get(table: string, key: string) {
    const redisKey = this.getRedisKey(table, key)
    return this.doInPool(async (client) => {
      const record = await client.get(redisKey)
      if (isNullable(record)) return
      return this.decode(record)
    }, `get ${redisKey}`)
  }

  async set(table: string, key: string, value: any, maxAge?: number) {
    if (isNullable(value)) return
    const redisKey = this.getRedisKey(table, key)
    return this.doInPool(async (client) => {
      await client.set(redisKey, this.encode(value), maxAge ? { PX: maxAge } : undefined)
    }, `set ${redisKey}`)
  }

  async delete(table: string, key: string) {
    const redisKey = this.getRedisKey(table, key)
    return this.doInPool(async (client) => {
      await client.del(redisKey)
    }, `delete ${redisKey}`)
  }

  async clear(table: string) {
    const redisKey = this.getRedisKey(table, '*')
    return this.doInPool(async (client) => {
      const allKeys = await client.keys(redisKey)
      await client.del(allKeys)
    }, `clear table ${redisKey}`)
  }
}

namespace RedisCache {
  export interface Config extends RedisClientOptions {
    endpoint?: string
    prefix?: string
  }

  export const Config: Schema<Config> = Schema.object({
    endpoint: Schema.string().role('link').description('Redis 服务器地址。').default('redis://localhost:6379'),
    prefix: Schema.string().description('Redis 键名前缀。').default('koishi:'),
  })
}

export default RedisCache
