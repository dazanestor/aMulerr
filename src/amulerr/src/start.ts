import { createStart, createMiddleware } from '@tanstack/react-start'

const myGlobalMiddleware = createMiddleware().server(({ next, request }) => {
  const url = new URL(request.url)
  console.log(`[request] ${request.method} ${url}`)

  return next()
})

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [myGlobalMiddleware],
  }
})
