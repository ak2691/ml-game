const CSRF_COOKIE_NAME = "XSRF-TOKEN";
const CSRF_HEADER_NAME = "X-XSRF-TOKEN";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

function readCookie(name) {
    const cookie = document.cookie
        .split("; ")
        .find((part) => part.startsWith(`${name}=`));

    return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

export function csrfHeaders(method = "GET") {
    if (SAFE_METHODS.has(method.toUpperCase())) {
        return {};
    }

    const token = readCookie(CSRF_COOKIE_NAME);
    return token ? { [CSRF_HEADER_NAME]: token } : {};
}
