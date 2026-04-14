import type { Handler } from "@netlify/functions";

const APX_TARGETS: Record<string, string> = {
  DEV: "https://apxconsole-dev-mx.work-02.nextgen.igrupobbva",
  INT: "https://apxconsole-int-mx.work-02.nextgen.igrupobbva",
  OCTA: "https://apxconsole-oct-mx.work-02.nextgen.igrupobbva",
  AUS: "https://apxconsole-aus-mx.work-02.nextgen.igrupobbva",
  PROD: "https://apxconsole-mx.live-02.nextgen.igrupobbva",
};

function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-session-cookie",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

function getHeaderValue(
  headers: Record<string, string | undefined>,
  key: string
): string {
  return headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()] ?? "";
}

function parseEnvAndPath(path: string): { env: string; restPath: string } | null {
  const normalizedPath = path.replace(
    /^\/\.netlify\/functions\/apx-console\/api\/apx-console\/?/,
    ""
  );

  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const [env, ...rest] = parts;

  return {
    env: env.toUpperCase(),
    restPath: rest.join("/"),
  };
}

function buildTargetUrl(path: string, rawQuery: string | undefined): string | null {
  const parsed = parseEnvAndPath(path);
  if (!parsed) return null;

  const targetBase = APX_TARGETS[parsed.env];
  if (!targetBase) return null;

  const url = new URL(`/APX_Operation/${parsed.restPath}`, targetBase);

  if (rawQuery) {
    url.search = rawQuery;
  }

  return url.toString();
}

export const handler: Handler = async (event) => {
  const corsHeaders = buildCorsHeaders();

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const sessionCookie = getHeaderValue(event.headers, "x-session-cookie").trim();

    if (!sessionCookie) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Falta x-session-cookie" }),
      };
    }

    const targetUrl = buildTargetUrl(event.path, event.rawQuery);

    if (!targetUrl) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Ruta o entorno APX inválido" }),
      };
    }

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
        Accept: "application/json",
      },
    });

    const responseText = await response.text();

    return {
      statusCode: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type": response.headers.get("content-type") || "application/json",
      },
      body: responseText,
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Error interno en proxy APX Console",
      }),
    };
  }
};