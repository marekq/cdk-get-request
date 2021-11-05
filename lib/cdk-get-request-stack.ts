import { CfnOutput, Construct, Duration, RemovalPolicy, Stack, StackProps } from '@aws-cdk/core';
import { HttpApi, HttpRouteKey, HttpRoute } from '@aws-cdk/aws-apigatewayv2';
import { HttpProxyIntegration } from '@aws-cdk/aws-apigatewayv2-integrations';
import { LogLevel, Pass, StateMachine, StateMachineType } from '@aws-cdk/aws-stepfunctions';
import { LogGroup } from '@aws-cdk/aws-logs';
import { CallApiGatewayHttpApiEndpoint, HttpMethod } from '@aws-cdk/aws-stepfunctions-tasks';

export class CdkGetRequestStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create API Gateway
    const apigw = new HttpApi(this, 'apigw', {
      createDefaultStage: true
    });

    // Create HTTP route to IP API
    const route = new HttpRoute(this, 'route1', {
      httpApi: apigw,
      integration: new HttpProxyIntegration({
        url: "https://api.ipify.org",
        method: HttpMethod.GET
      }),
      routeKey: HttpRouteKey.with("/", HttpMethod.GET),
    })

    // Create Step Function CloudWatch Logs
    const SFlogGroup = new LogGroup(this, 'SFlogGroup', {
      logGroupName: '/aws/lambda/cdk-get-request-stack-StateMachine-1',
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Create GET request
    const sfDefinition = new CallApiGatewayHttpApiEndpoint(this, 'StateMachine', {
      apiId: apigw.httpApiId,
      apiStack: Stack.of(apigw),
      method: HttpMethod.GET,
      outputPath: "$.ResponseBody"
    });

    // Create express state machine with logging enabled
    const stateMachine = new StateMachine(this, 'HTTPStateMachine', {
      definition: sfDefinition,
      tracingEnabled: true,
      stateMachineType: StateMachineType.EXPRESS,
      timeout: Duration.minutes(1),
      logs: {
        destination: SFlogGroup,
        level: LogLevel.ALL
      },
    });      

    // Print the URL of API Gateway
    new CfnOutput(this, 'API URL', { value: apigw.url ?? 'deployment error' });
  }
}
