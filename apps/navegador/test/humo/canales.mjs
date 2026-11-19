// Los directos con más espectadores ahora, como invitado (la misma API que el reproductor web): para las pruebas que
// necesitan canales en directo y no les importa cuáles.
export const topChannels = async (count) => {
  const response = await fetch("https://gql.twitch.tv/gql", {
    body: JSON.stringify({
      query: `query { streams(first: ${Math.min(30, count * 2)}) { edges { node { type broadcaster { login } } } } }`,
    }),
    headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "text/plain" },
    method: "POST",
  })
  const { data } = await response.json()
  return data.streams.edges
    .filter(({ node }) => node.type === "live" && node.broadcaster !== null)
    .map(({ node }) => node.broadcaster.login)
    .slice(0, count)
}
