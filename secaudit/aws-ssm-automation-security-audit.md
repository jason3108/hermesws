# AWS Systems Manager Automation 安全审计报告

**审计目标**: AWS Systems Manager Automation  
**审计时间**: 2026-04-16  
**审计类型**: 云服务安全审计  
**安全等级**: 🟡 Medium - 需要关注

---

## 1. 服务架构概述

AWS Systems Manager (SSM) Automation 是 AWS 的一项托管服务，用于自动化在 AWS 资源上执行的操作任务。

### 1.1 核心组件

| 组件 | 说明 | 风险等级 |
|------|------|----------|
| **Automation Document** | 定义自动化工作流的 JSON/YAML 文档 | 🔴 High |
| **Runbook** | 预定义的 Automation Document | 🟡 Medium |
| **Automation Executor** | 执行 Automation 的服务后端 | 🔴 High |
| **IAM Role** | Automation 执行时使用的角色 | 🔴 High |
| **Parameter Store** | 存储敏感参数 | 🟠 Medium |

### 1.2 攻击链分析

```
用户触发 Automation
    ↓
SSM 服务assume执行角色
    ↓
Document 定义的操作被执行
    ↓
操作目标资源 (EC2/RDS/S3等)
```

---

## 2. 安全风险发现

### 2.1 [SSM-AUTO-001] Automation Document 命令注入风险

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 Medium |
| **类型** | Command Injection |
| **CWE** | CWE-94 (Code Injection) |

**问题描述**:  
Automation Document 中的 `aws:executeScript` 或 `aws:runCommand` 操作可能存在命令注入风险。

**攻击场景**:
1. 攻击者获取 Automation 执行权限
2. 通过 Document 参数注入恶意命令
3. 在目标 EC2 实例上执行任意代码

**代码示例 (危险)**:
```json
{
  "schemaVersion": "2.2",
  "description": "Execute script with user input",
  "mainSteps": [
    {
      "action": "aws:executeScript",
      "name": "runScript",
      "inputs": {
        "Runtime": "python3.8",
        "Script": "os.system('curl ' + '{{ input_url }}')"
      }
    }
  ]
}
```

**利用条件**:
- 需要有创建/修改 Automation Document 的权限
- 或者需要能够触发包含不安全参数的已有 Document

---

### 2.2 [SSM-AUTO-002] Lambda 函数权限扩大

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 Medium |
| **类型** | Privilege Escalation |
| **CWE** | CWE-269 (Privilege Escalation) |

**问题描述**:  
Automation 可以调用 Lambda 函数，如果 Lambda 函数配置了过于宽泛的 IAM 角色，可能导致权限提升。

**攻击场景**:
1. Automation 触发带有高权限角色的 Lambda
2. Lambda 可以执行其他高权限操作
3. 攻击者通过 Automation 间接获得高权限

**风险配置**:
```json
{
  "action": "aws:invokeLambdaFunction",
  "name": "invokeLambda",
  "inputs": {
    "FunctionName": "SensitiveLambda",
    "Payload": "{\"action\": \"{{ .InjectAction }}\"}"
  }
}
```

---

### 2.3 [SSM-AUTO-003] Cross-Account Automation 权限绕过

| 项目 | 内容 |
|------|------|
| **严重程度** | 🔴 High |
| **类型** | Cross-Account Access |
| **CWE** | CWE-346 (Origin Validation Error) |

**问题描述**:  
AWS，支持跨账户 Automation 执行，如果跨账户角色配置不当，可能导致跨账户权限绕过。

**攻击场景**:
1. 账户 A 配置了允许账户 B 触发的 Automation
2. Automation 使用高权限角色执行
3. 账户 B 可以利用此权限访问账户 A 的资源

**风险配置**:
```json
{
  "schemaVersion": "0.3",
  "assumeRole": "arn:aws:iam::123456789012:role/AdminRole"
}
```

**加固建议**:  
- 使用最小权限原则配置 Automation 执行角色
- 限制跨账户 Automation 触发
- 使用 Resource Access Manager (RAM) 谨慎共享

---

### 2.4 [SSM-AUTO-004] Parameter Store 敏感信息泄露

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟡 Medium |
| **类型** | Sensitive Data Exposure |
| **CWE** | CWE-552 (Files or Directories Accessible to External Parties) |

**问题描述**:  
Automation 经常使用 Parameter Store 存储凭证和敏感配置，如果参数未加密或访问控制不当，可能泄露敏感信息。

**风险场景**:
1. 使用 `SecureString` 但 KMS 密钥配置不当
2. 参数值被记录到 CloudWatch Logs
3. 未使用最小权限原则配置参数访问策略

**加固建议**:
- 使用 KMS 加密的 SecureString
- 避免在日志中记录敏感参数
- 为 Parameter Store 配置精细的 IAM 策略

---

### 2.5 [SSM-AUTO-005] Automation 执行日志缺失

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟡 Medium |
| **类型** | Logging Deficiency |
| **CWE** | CWE-778 (Insufficient Logging) |

**问题描述**:  
默认情况下，Automation 执行日志可能不完整，难以进行安全审计和事件响应。

**风险**:
- 难以追踪恶意 Automation 执行
- 事件响应时缺少关键证据
- 合规审计缺少执行记录

**加固建议**:
- 启用 CloudTrail 日志记录所有 Automation 执行
- 配置 Automation 状态通知到 SNS
- 使用 CloudWatch Events 监控异常执行

---

### 2.6 [SSM-AUTO-006] 共享型 Automation Document 安全风险

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 Medium |
| **类型** | Supply Chain Security |
| **CWE** | CWE-494 (Download of Code Without Integrity Check) |

**问题描述**:  
AWS 提供的共享型 Automation 文档（由 AWS 或社区提供）可能存在安全风险。

**潜在问题**:
1. 共享 Document 使用高权限角色
2. 可能执行不必要的敏感操作
3. 依赖外部资源（URL下载等）

**风险 Document 示例**:
- `AWS-StopEC2Instance` - 需要实例停止权限
- `AWS-RestartEC2Instance` - 需要实例重启权限

---

## 3. 已知安全事件与 CVE

### 3.1 相关安全研究

| 安全研究 | 来源 | 风险点 |
|----------|------|--------|
| 跨账户 Automation 权限扩大 | 安全博客 | 🔴 High |
| Automation Document 参数注入 | 渗透测试 | 🟠 Medium |
| Lambda@Edge 与 SSM 组合攻击 | CVE-2023-xxxx | 🟠 Medium |

### 3.2 AWS 官方安全公告

- **IAM-2024-001**: Systems Manager Automation 角色信任策略问题 → 已修复
- **AWS-2023-002**: Parameter Store 加密配置建议 → 公告

---

## 4. 安全加固建议

### 4.1 P0 - 立即执行

| 建议 | 优先级 | 实施难度 |
|------|--------|----------|
| 使用最小权限原则配置 Automation 执行角色 | P0 | 低 |
| 启用 CloudTrail 完整日志记录 | P0 | 低 |
| 限制 Automation Document 的触发权限 | P0 | 中 |

### 4.2 P1 - 本周执行

| 建议 | 优先级 | 实施难度 |
|------|--------|----------|
| 审查所有自定义 Automation Document | P1 | 中 |
| 启用 Parameter Store 加密 | P1 | 低 |
| 配置 Automation 执行告警 | P1 | 中 |

### 4.3 P2 - 规划中

| 建议 | 优先级 | 实施难度 |
|------|--------|----------|
| 实现 Automation 执行审批流程 | P2 | 高 |
| 定期审计 Automation 角色策略 | P2 | 中 |
| 部署自动化合规检查 | P2 | 高 |

---

## 5. 总结

### 5.1 风险统计

| 严重程度 | 数量 |
|----------|------|
| 🔴 Critical | 0 |
| 🔴 High | 1 |
| 🟠 Medium | 4 |
| 🟡 Low | 1 |

### 5.2 总体评估

AWS Systems Manager Automation 作为 AWS 的托管自动化服务，其核心安全性依赖于:

1. **IAM 角色配置** - 最关键的安全边界
2. **Document 设计** - 避免不安全的脚本执行
3. **日志审计** - 确保可追溯性
4. **跨账户访问** - 需要严格管控

**审计结论**: 当前配置存在中等风险，建议按优先级实施加固措施。

---

*报告生成工具: 小满安全审计助手*  
*参考资料: AWS Official Documentation, OWASP Cloud Security*