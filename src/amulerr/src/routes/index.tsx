import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <main className="p-4">
      <h1 className="mb-8">Welcome to aMulerr!</h1>
      <p className="my-2">
        In order to get started, configure the Download Client in *RR:
      </p>
      <ul className="list-disc pl-16 [&>*]:select-text">
        <li>Type: qBittorrent</li>
        <li>Name: aMulerr</li>
        <li>Host: THIS_CONTAINER_NAME</li>
        <li>Port: 3000</li>
        <li>Priority: 50</li>
        <li>Remove completed: Yes</li>
      </ul>
      <p className="my-2">
        Also set the Download Client's Remote Path Mappings:
      </p>
      <ul className="list-disc pl-16 [&>*]:select-text">
        <li>Host: amulerr</li>
        <li>Remote Path: /downloads</li>
        <li>
          Local Path: {'{'}The /downloads folder inside MOUNTED PATH FOR RADARR
          {'}'}
        </li>
      </ul>
      <p className="my-2 mt-8">Then, configure the indexer in *RR:</p>
      <ul className="list-disc pl-16 [&>*]:select-text">
        <li>Type: Torznab</li>
        <li>Name: aMulerr</li>
        <li>RSS: No</li>
        <li>Automatic Search: Up to you, maybe it downloads porn</li>
        <li>Interactive Search: Yes</li>
        <li>URL: http://THIS_CONTAINER_NAME:3000/</li>
        <li>Download Client: aMulerr</li>
      </ul>
    </main>
  )
}
