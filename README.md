# ecs-expose-port

Auto naming of objects for easier debugging.

```
npm install ecs-expose-port
```

## Usage

``` js
const ecsExposePort = require('ecs-expose-port')

const { connection, port } = await ecsExposePort({
  service: 'service_name',
  username: 'ec2-user',
  containerPort: 80
})

// Do something with port
// E.g. curl http://localhost:{port}

await connection.shutdown()
```

## License

MIT
