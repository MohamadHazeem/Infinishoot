// Extra worker endpoints, one module per feature. Each route is
// `async (req, env, url, { json, cors, clean }) => Response | null`: return null when the path isn't yours.
// Add a feature by importing its handler and appending it to ROUTES (one line each, so features don't collide).
import { ghostRoute } from './ghost.js'; // coop2 lane: help ghosts (/ghost)
import { ghostsRoute } from './ghosts.js'; // modes lane: weekly ghost board (/ghosts)
import { lobbies } from './lobbies.js'; // MP lane: public lobby browser
import { teamboard } from './teamboard.js'; // MP lane: weekly co-op team board

export const ROUTES = [ghostRoute, ghostsRoute, lobbies, teamboard];
