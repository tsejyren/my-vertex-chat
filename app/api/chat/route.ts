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

// --- 2. 通过 OIDC 令牌换取 GCP 访问令牌 ---
async function getAccessToken(): Promise<string> {
  const token = await getVercelOidcToken();
  
  const response = await fetch(
    `https://sts.googleapis.com/v1/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        subject_token: token,
        audience: `//iam.googleapis.com/projects/${gcpConfig.projectNumber}/locations/global/workloadIdentityPools/${gcpConfig.poolId}/providers/${gcpConfig.providerId}`,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ STS 令牌交换失败:', response.status, errorText);
    throw new Error('Failed to exchange OIDC token for GCP access token');
  }

  const data = await response.json();
  return data.access_token;
}

// --- 3. Vertex AI Search 检索函数 ---
async function searchVertex(query: string): Promise<string> {
  console.log('🔍 检索开始，查询词:', query);
  try {
    const accessToken = await getAccessToken();
    
    const response = await fetch(
      `https://discoveryengine.googleapis.com/v1/projects/${gcpConfig.projectId}/locations/global/collections/default_collection/dataStores/jyren-zhuan-law/servingConfigs/default_config:search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query,
          pageSize: 3,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Vertex API 错误:', response.status, errorText);
      return '';
    }

    const data = await response.json();
    const results = data.results || [];
    console.log('🔍 检索到结果数量:', results.length);

    if (results.length === 0) return '';

    const contexts = results
      .map((result: any) => result.document?.derivedStructData?.content || null)
      .filter((text: string | null) => text !== null)
      .join('\n\n---\n\n');

    console.log('🔍 提取的知识内容长度:', contexts.length);
    return contexts;
  } catch (error) {
    console.error('❌ 检索失败:', error);
    return '';
  }
}

// --- 4. POST 处理函数 ---
export async function POST(req: Request) {
  console.log('🚀 收到新请求');
  try {
    const body = await req.json();
    const messages = body.messages || [];
    
    // 提取用户查询
    let userQuery = '';
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.content && typeof lastMsg.content === 'string') {
      userQuery = lastMsg.content;
    } else if (lastMsg?.text && typeof lastMsg.text === 'string') {
      userQuery = lastMsg.text;
    }
    console.log('📝 用户查询:', userQuery);

    // 检索知识库
    let knowledgeContext = '';
    if (userQuery) {
      knowledgeContext = await searchVertex(userQuery);
    }

    // 构建系统提示词
    let systemPrompt = '你是一个乐于助人的智能助手。';
    if (knowledgeContext && knowledgeContext.length > 0) {
      systemPrompt = `你是一位资深的中级注册安全工程师导师。请严格基于以下知识库内容回答用户的问题。
如果知识库中没有相关信息，请直接告诉用户"没有找到相关内容"。

回答完毕后，请在末尾用 Markdown 的 <details> 标签列出参考来源。

【知识库内容】
${knowledgeContext}`;
    }

    // --- 调用 AI Gateway 官方免费模型（无 BYOK）---
    console.log('🤖 调用免费模型: xai/grok-4.1-fast-non-reasoning...');
    const result = await streamText({
      // 使用免费模型
      model: 'xai/grok-4.1-fast-non-reasoning',
      messages: messages,
      system: systemPrompt,
      // 移除 BYOK 配置，使用免费额度
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