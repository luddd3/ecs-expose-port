const AWS = require('aws-sdk')
const fs = require('fs/promises')
const getPort = require('get-port')
const { SSHConnection } = require('node-ssh-forward')
const os = require('os')
const path = require('path')
const { promisify } = require('util')

module.exports = async function ecsExposePort ({
  service,
  containerPort,
  username,
  localPort,
  cluster = 'default',
  region = 'eu-west-1'
}) {
  if (!service) {
    throw new Error('service required')
  }
  if (!username) {
    throw new Error('username required')
  }
  if (!containerPort) {
    throw new Error('containerPort required')
  }

  const tasks = await getTaskInstances(region, cluster, service)
  const task = tasks.find(
    t => t.lastStatus === 'RUNNING' && t.desiredStatus === 'RUNNING'
  )
  const binding = task.networkBindings.find(
    x => x.containerPort === containerPort
  )
  const remoteIp = task.publicIpAddress
  const remotePort = binding.hostPort

  const keyName = `${task.keyName}.pem`
  const privateKey = await fs.readFile(path.join(os.homedir(), '.ssh', keyName))
  const sshConnection = new SSHConnection({
    username,
    privateKey,
    endHost: remoteIp
  })

  if (!localPort) {
    localPort = await getPort({ port: getPort.makeRange(20e3, 30e3) })
  }
  await sshConnection.forward({
    fromPort: localPort,
    toPort: remotePort
  })
  return {
    connection: sshConnection,
    port: localPort
  }
}

const getTaskInstances = promisify((region, cluster, serviceName, cb) => {
  const ecs = new AWS.ECS({ region })
  const ec2 = new AWS.EC2({ region })
  ecs.listTasks({ cluster, serviceName }, (err, results) => {
    if (err) return cb(err)
    const taskArns = results.taskArns
    if (taskArns.length === 0) {
      return taskArns
    }

    ecs.describeTasks({ cluster, tasks: taskArns }, (err, results) => {
      if (err) return cb(err)
      const tasks = results.tasks
      if (tasks.length === 0) {
        return tasks
      }

      ecs.describeContainerInstances(
        {
          cluster,
          containerInstances: tasks.map(x => x.containerInstanceArn)
        },
        (err, results) => {
          if (err) return cb(err)
          const containerInstances = results.containerInstances
          if (containerInstances.length === 0) {
            return containerInstances
          }

          const instanceIds = containerInstances.map(x => x.ec2InstanceId)
          ec2.describeInstances(
            { InstanceIds: instanceIds },
            (err, results) => {
              if (err) return cb(err)
              const instances = results.Reservations.flatMap(x => x.Instances)
              if (instances.length === 0) {
                return instances
              }

              const arr = []
              for (const task of tasks) {
                const containerInstance = containerInstances.find(
                  x => x.containerInstanceArn === task.containerInstanceArn
                )
                const ec2Instance = instances.find(
                  x => x.InstanceId === containerInstance.ec2InstanceId
                )
                arr.push({
                  instanceId: ec2Instance.InstanceId,
                  keyName: ec2Instance.KeyName,
                  publicIpAddress: ec2Instance.PublicIpAddress,
                  lastStatus: task.lastStatus,
                  desiredStatus: task.desiredStatus,
                  networkBindings: task.containers[0]?.networkBindings || []
                })
              }
              cb(null, arr)
            }
          )
        }
      )
    })
  })
})
