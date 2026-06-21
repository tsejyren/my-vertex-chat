import { getVercelOidcToken } from '@vercel/functions/oidc';
import { streamText } from 'ai';

// --- 1. GCP 配置（从环境变量读取）---
const gcpConfig = {
  projectId: process.env.GCP_PROJECT_ID!,
  projectNumber: process.env.GCP_PROJECT_NUMBER!,
  serviceAccountEmail: process.env.GCP_SERVICE_ACCOUNT_EMAIL!,
  poolId: process.env.GCP_WORKLOAD_IDENTITY_POOL_ID!,
  providerId: process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID!,
};

// --- 2. 通过 OIDC 令牌换取 GCP 访问令牌 (暂时注释，准备后续启用) ---
// async function getAccessToken(): Promise<string> {
//   const token = await getVercelOidcToken();
//   // ... (其余实现不变)
// }

// --- 3. Vertex AI Search 检索函数 (暂时注释，准备后续启用) ---
// async function searchVertex(query: string): Promise<string> {
//   console.log('🔍 检索开始，查询词:', query);
//   // ... (其余实现不变)
// }

// --- 4. POST 处理函数 ---
export async function POST(req: Request) {
  console.log('🚀 收到新请求');
  try {
    const body = await req.json();
    const messages = body.messages || [];

    // 提取用户查询 (仅用于日志，暂不检索)
    let userQuery = '';
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.content && typeof lastMsg.content === 'string') {
      userQuery = lastMsg.content;
    } else if (lastMsg?.text && typeof lastMsg.text === 'string') {
      userQuery = lastMsg.text;
    }
    console.log('📝 用户查询:', userQuery);

    // --- 暂时注释知识库检索逻辑，专注于 AI 对话功能 ---
    // let knowledgeContext = '';
    // if (userQuery) {
    //   knowledgeContext = await searchVertex(userQuery);
    // }

    // 构建系统提示词 (暂时不含知识库上下文)
    let systemPrompt = '你是一个乐于助人的智能助手。';
    // if (knowledgeContext && knowledgeContext.length > 0) {
    //   systemPrompt = `...知识库内容...`;
    // }

    // --- 调用 AI Gateway 官方免费模型 (无 BYOK) ---
    console.log('🤖 调用模型: xai/grok-4.1-fast-non-reasoning...');
    const result = await streamText({
      // 使用 xAI 的 Grok 模型，支持免费额度调用
      model: 'xai/grok-4.1-fast-non-reasoning',
      messages: messages,
      system: systemPrompt,
      // 注意：这里移除了 providerOptions.gateway.byok，因为免费额度不支持
    });

    console.log('✅ 调用成功');
    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('❌ 错误:', error);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }),
      { status: 500 }
    );
  }
}