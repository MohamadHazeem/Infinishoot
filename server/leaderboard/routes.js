// Extra worker endpoints, one module per feature. Each route is
// `async (req, env, url, { json, cors, clean }) => Response | null`: return null when the path isn't yours.
// Add a feature by importing its handler and appending it to ROUTES (one line each, so features don't collide).

export const ROUTES = [];
