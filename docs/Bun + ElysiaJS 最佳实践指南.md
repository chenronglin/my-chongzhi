# Bun + ElysiaJS 最佳实践指南

这是基于 **Bun** 运行时和 **ElysiaJS** 框架的现代后端开发约定。

我们的目标是构建高性能、低依赖、类型安全的系统。主要原则是：**SQL First**（原生 SQL 优于 ORM）和 **Bun Native First**（优先使用运行时内置工具）。

## 项目结构

采用**领域驱动（Domain-Driven）**结构。避免按 controller/service 分层，而是将业务闭环在模块内部。

Plaintext

```
bun-project
├── src
│   ├── modules          # 业务领域模块
│   │   ├── auth
│   │   │   ├── index.ts   					# 导出模块
│   │   │   ├── auth.routers.ts  		# API 路由定义
│   │   │   ├── auth.service.ts     # 业务逻辑服务
│   │   │   ├── auth.repository.ts  # 数据库操作
│   │   │   ├── auth.types.ts       # 模块类型定义
│   │   │   └── auth.schema.ts      # 请求/响应 Schema (Typebox)
│   │   └── users
│   │       ├── index.ts
│   │       ├── users.routers.ts
│   │       └── ...
│   ├── lib              # 基础设施
│   │   ├── db.ts        # 数据库连接实例 (bun:sqlite 或 驱动封装)
│   │   ├── utils.ts     # 通用工具
│   │   └── errors.ts    # 自定义错误
│   ├── env.ts           # 环境变量检查
│   └── index.ts         # 应用入口
├── tests/
├── bun.lockb
├── package.json
└── tsconfig.json
```

**核心约定：**

1. **模块自包含**：每个模块应包含自己的路由定义(routers)、业务逻辑服务(service)、数据库操作(repository)、模块类型定义(types)、请求/响应(schema)。
2. **模块界面**：模块之间只能通过“接口（contract）通信”，不能直接互相调用内部逻辑。

------

## 拥抱 Bun 原生工具箱

Bun 的核心优势在于它内置了大量经过 Zig 优化的高性能标准库。在引入第三方 npm 包之前，先检查 `Bun.*` 是否已有实现。

### 核心原则

如果 Bun 提供了原生 API，**绝对不要**使用 Node.js 的 polyfill 或第三方库。

### 常用原生 API 替代方案

| **场景**      | **传统/第三方库**     | **Bun 最佳实践**         | **优势**                                            |
| ------------- | --------------------- | ------------------------ | --------------------------------------------------- |
| **UUID 生成** | `uuid` (npm)          | **`Bun.randomUUIDv7()`** | 原生实现，v7 版本基于时间戳排序，对数据库索引更友好 |
| **文件读写**  | `fs`, `fs-extra`      | **`Bun.file(path)`**     | 懒加载，基于 web 标准的 File API，性能极高          |
| **密码哈希**  | `bcrypt`, `argon2`    | **`Bun.password`**       | 内置 Argon2 实现，无需编译原生模块                  |
| **压缩**      | `zlib`, `gzip`        | **`Bun.gzipSync`**       | 同步/异步原生压缩，零开销                           |
| **Base64**    | `js-base64`           | **`atob` / `btoa`**      | 全局内置，基于 Web 标准优化                         |
| **环境变量**  | `dotenv`              | **`Bun.env`**            | 零配置，直接读取 `.env`，读取速度更快               |
| **HTTP 请求** | `axios`, `node-fetch` | **`fetch`**              | Bun 的 `fetch` 是基于原生实现的，完全符合 Web 标准  |
| **测试**      | `jest`, `vitest`      | **`bun:test`**           | 启动速度极快，API 兼容 Jest                         |

**代码示例：**

TypeScript

```
// src/lib/utils.ts

// 1. 生成对数据库友好的 UUID
export const generateId = () => Bun.randomUUIDv7();

// 2. 高性能哈希
export const hashPassword = async (pwd: string) => {
    return await Bun.password.hash(pwd, {
        algorithm: "argon2id", // 推荐算法
        memoryCost: 4096,
        timeCost: 3,
    });
};

// 3. 读取配置文件 (比 fs.readFileSync 快)
export const getConfig = async () => {
    const file = Bun.file("./config.json");
    if (await file.exists()) {
        return await file.json();
    }
    return {};
};
```

------

## 数据层：SQL First (Bun Native SQL)

拒绝 Drizzle 或 Prisma 等 ORM。ORM 会增加冷启动时间、运行时开销，并生成难以调试的查询。

### 拒绝 ORM，回归 SQL

直接编写 SQL。这让你能完全控制查询性能，利用数据库的特定功能（如 CTE、JSON 操作、Window Functions）。

- 对于 Sqlite：直接使用内置的 `bun:sqlite`。
- 对于 Redis：直接使用内置的 `bun:redis`。
- 对于 Postgres/MySQL：使用Bun内置的 `import { sql, SQL } from "bun";` 。

### 数据库模块封装

以 `bun:sqlite` 为例，这是目前 Bun 性能最强悍的组合。

TypeScript

```
// src/lib/db.ts
import { Database } from "bun:sqlite";

// 这里使用了 Bun 内置的 SQLite，性能远超基于 C 的 node-sqlite3
export const db = new Database("mydb.sqlite", { create: true });

// 开启 WAL 模式以提高并发性能
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");

export default db;
```

**业务中使用 (Repository 模式)：**

TypeScript

```
// src/modules/users/users.sql.ts
// 将 SQL 语句分离，保持代码整洁
export const SQL = {
    insertUser: `
        INSERT INTO users (id, username, email, created_at)
        VALUES ($id, $username, $email, $created_at)
        RETURNING id, username
    `,
    findById: `SELECT * FROM users WHERE id = $id`
} as const;

// src/modules/users/users.service.ts
import db from "../../lib/db";
import { SQL } from "./users.sql";
import { generateId } from "../../lib/utils";

export class UserService {
    createUser(username: string, email: string) {
        // 预编译语句 (Prepared Statement) 是最佳实践
        // Bun 会缓存预编译语句，性能极高
        const query = db.query(SQL.insertUser);
        
        return query.get({
            $id: generateId(), // 使用 Bun.randomUUIDv7
            $username: username,
            $email: email,
            $created_at: Date.now()
        });
    }

    getUser(id: string) {
        return db.query(SQL.findById).get({ $id: id });
    }
}
```

------

## 类型与验证 (TypeBox)

Elysia 深度集成了 TypeBox。虽然你可以写 schema，但不要为了验证引入 Zod，**TypeBox** 编译为 JIT 代码，是 JS 生态中最快的验证库之一。

### 使用 `t` 进行极致验证

TypeScript

```
import { Elysia, t } from 'elysia'

// 定义可复用的 Schema
const UserSchema = t.Object({
    id: t.String(),
    username: t.String(),
    email: t.String({ format: 'email' })
})

export const usersController = new Elysia({ prefix: '/users' })
    .post('/', ({ body }) => {
        // 这里的 body 在运行时会被验证，在开发时有 TS 类型提示
        return { id: Bun.randomUUIDv7(), ...body }
    }, {
        body: t.Object({
            username: t.String({ minLength: 3 }),
            email: t.String({ format: 'email' })
        }),
        response: UserSchema // 显式定义响应格式，加速序列化并生成文档
    })
```

------

## 依赖注入与上下文

利用 Elysia 的 `.derive` 和 `.state` 模式，而不是传统的类构造函数注入。这更符合函数式和组合式的设计。

TypeScript

```
// src/lib/context.ts
import { Elysia } from 'elysia'
import { UserService } from '../modules/users/users.service'

// 组装上下文
export const ctx = new Elysia()
    .decorate('userService', new UserService()) // 单例服务注入
    .derive(({ headers }) => {
        // 请求级上下文 (类似中间件)
        const authHeader = headers['authorization'];
        return {
            token: authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
        }
    });
```

**在控制器中使用：**

TypeScript

```
import { ctx } from '../../lib/context'

export const postController = new Elysia()
    .use(ctx) // 应用上下文
    .get('/profile', ({ userService, token, error }) => {
        if (!token) return error(401, 'Unauthorized');
        
        // userService 和 token 这里都是类型安全的
        return userService.findByToken(token);
    })
```

------

## 测试 (Bun Test)

放弃 Jest。`bun:test` 是原生的、极速的，并且 API 兼容。

**单元测试示例：**

TypeScript

```
// tests/utils.test.ts
import { describe, expect, test } from "bun:test";
import { generateId } from "../src/lib/utils";

describe("Utils", () => {
    test("generateId should return a string", () => {
        const id = generateId();
        expect(typeof id).toBe("string");
        // UUIDv7 长度通常是 36
        expect(id.length).toBe(36);
    });
});
```

集成测试 (使用 Elysia Eden Treaty)：

在测试中直接调用 API 逻辑，而不是发 HTTP 请求，速度更快。

TypeScript

```
// tests/user.test.ts
import { describe, expect, test } from "bun:test";
import { app } from "../src/index"; // 导入你的 Elysia 实例
import { treaty } from "@elysiajs/eden";

const api = treaty(app);

describe("User Module", () => {
    test("POST /users creates a user", async () => {
        const { data, error } = await api.users.post({
            username: "bun_master",
            email: "test@bun.sh"
        });

        expect(error).toBeNull();
        expect(data?.username).toBe("bun_master");
        expect(data?.id).toBeString();
    });
});
```

------

## 工具链 (Biome)

为了匹配 Bun 的速度，使用 **Biome** 替代 Prettier 和 ESLint。Biome 基于 Rust，秒级完成大型项目的格式化和 Lint。

**配置 `biome.json`：**

JSON

```
{
  "$schema": "https://biomejs.dev/schemas/1.8.3/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "useConst": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "lineWidth": 100
  }
}
```

**Package.json Scripts:**

JSON

```
"scripts": {
    "dev": "bun --watch src/index.ts",
    "test": "bun test",
    "lint": "biome check src",
    "format": "biome check --write src"
}
```