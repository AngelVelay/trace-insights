import type { Handler } from "@netlify/functions";

const FRESNO_BASE_URL = "https://bbva-es-government-ing.appspot.com";

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

function buildTargetUrl(path: string, rawQuery: string | undefined): string {
  const normalizedPath = path.replace(/^\/\.netlify\/functions\/fresno\/api\/fresno\/?/, "");
  const url = new URL(`/c/${normalizedPath}`, FRESNO_BASE_URL);

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
          error instanceof Error ? error.message : "Error interno en proxy Fresno",
      }),
    };
  }
};