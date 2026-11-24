import { useState } from 'react'

const IDEAS = ['a portfolio', 'a landing page', 'a tiny game', 'docs for a project', 'a dashboard for public data']

export default function App() {
  const [i, setI] = useState(0)
  return (
    <main>
      <span className="tag">React · live on ms.computer</span>
      <h1>{'{{SITE_NAME}}'}</h1>
      <p className="lede">
        A React app built by GitHub Actions and served from ms.computer. Edit <code>src/App.jsx</code> and push — it
        redeploys by itself.
      </p>
      <button onClick={() => setI((n) => (n + 1) % IDEAS.length)}>
        Turn it into {IDEAS[i]} →
      </button>
      <footer>
        Hosted on <a href="https://ms.computer">ms.computer</a> · started with Shipyard
      </footer>
    </main>
  )
}
