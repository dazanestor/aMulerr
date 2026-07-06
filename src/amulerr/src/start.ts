import { createStart, createMiddleware } from '@tanstack/react-start'

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            PUID: string;
            PGID: string;
            AMULE_HOST: string;
            AMULE_PORT: string;
            AMULE_PWD: string;
            ALLOWED_CATEGORIES?: string;
        }
    }
}

const myGlobalMiddleware = createMiddleware().server(({ next, request }) => {
    const url = new URL(request.url)
    console.log(
        `[request] ${request.method} ${url}`,
    )

    return next()
})

export const startInstance = createStart(() => {
    return {
        requestMiddleware: [myGlobalMiddleware],
    }
})
