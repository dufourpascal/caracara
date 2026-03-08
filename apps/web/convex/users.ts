import { query } from "./_generated/server"

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      return null
    }

    return {
      email: identity.email ?? null,
      name: identity.name ?? null,
      subject: identity.subject,
      tokenIdentifier: identity.tokenIdentifier,
    }
  },
})
