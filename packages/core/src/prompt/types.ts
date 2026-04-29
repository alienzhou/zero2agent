/**
 * Prompt 模块类型定义
 *
 * 定义 System Prompt 和 UserTask 构建器的接口
 */

/**
 * System Prompt 构建选项
 *
 * 用于配置 buildSystemPrompt 函数的行为
 */
export interface SystemPromptOptions {
  /**
   * 额外的指令列表
   * 来自项目、组织、用户偏好的外部规则
   * S004 暂不使用，预留扩展位
   */
  instructions?: string[];

  /**
   * 任务模式
   * 如 plan/debug/review 等
   * S004 暂不使用，预留扩展位
   */
  mode?: string;
}

/**
 * UserTask 构建选项
 *
 * 用于配置 buildUserTaskMessage 函数的行为
 */
export interface UserTaskOptions {
  /**
   * 用户原始输入消息
   */
  rawUserMessage: string;

  /**
   * 当前工作目录
   */
  cwd?: string;

  /**
   * 当前日期（格式：YYYY-MM-DD）
   */
  date?: string;

  /**
   * 运行平台
   * S004 预留扩展位
   */
  platform?: string;

  /**
   * 仓库根目录
   * S004 预留扩展位
   */
  repoRoot?: string;
}
