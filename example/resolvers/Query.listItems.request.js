// example/resolvers/Query.listItems.request.js
// AppSync JS resolver — request phase
export function request(ctx) {
  return {
    operation: 'Scan',
  };
}

// example/resolvers/Query.listItems.response.js
export function response(ctx) {
  return ctx.result;
}
