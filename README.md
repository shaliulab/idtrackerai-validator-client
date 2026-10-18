# idtrackerai-validator-client

React frontend of the FlyHostel idtrackerai validator, built with [Vite](https://vite.dev).

- `npm start`: dev server on port 3000 with hot reload; `/api` is proxied to the
  backend on `$REACT_APP_BACKEND_PORT` (default 5000).
- `npm run build`: production build in `build/`, copied into the server package by
  `build_frontend.sh` in the parent repository.
- `npm run preview`: serves `build/` locally.
