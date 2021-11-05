import { CfnOutput, Construct, Duration, RemovalPolicy, Stack, StackProps } from '@aws-cdk/core';
import { HttpApi, HttpRouteKey, HttpRoute } from '@aws-cdk/aws-apigatewayv2';
import { HttpProxyIntegration } from '@aws-cdk/aws-apigatewayv2-integrations';
import { JsonPath, LogLevel, Pass, StateMachine, StateMachineType } from '@aws-cdk/aws-stepfunctions';
import { LogGroup } from '@aws-cdk/aws-logs';
import { CallApiGatewayHttpApiEndpoint, DynamoAttributeValue, DynamoPutItem, HttpMethod } from '@aws-cdk/aws-stepfunctions-tasks';
import { AttributeType, BillingMode ,Table } from '@aws-cdk/aws-dynamodb';

export class CdkGetRequestStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create DynamoDB table
    const ddbTable = new Table(this, 'Table', {
      partitionKey: {
        name: 'timest',
        type: AttributeType.STRING
      },
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: BillingMode.PAY_PER_REQUEST
    });

    // Create API Gateway
    const apigw = new HttpApi(this, 'ProxyApiGw', {
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

    // Create DynamoDB PutItem step with IP and timestamp
    const ddbPutStep = new DynamoPutItem(this, 'DynamoPutItem', {
      table: ddbTable,
      item: {
        ip: DynamoAttributeValue.fromString(JsonPath.stringAt('$')),
        timest: DynamoAttributeValue.fromString(JsonPath.stringAt('$$.Execution.StartTime')),
        //context: DynamoAttributeValue.fromString(JsonPath.stringAt('$$'))
      }
    });

    // Create GET request
    const httpGetStep = new CallApiGatewayHttpApiEndpoint(this, 'StateMachine', {
      apiId: apigw.httpApiId,
      apiStack: Stack.of(apigw),
      method: HttpMethod.GET,
      outputPath: "$.ResponseBody"
    });

    // Create Step Function definition
    const sfDefinition = httpGetStep.next(ddbPutStep);

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

    // Grant DynamoDB read/write permissions to the state machine
    ddbTable.grantReadWriteData(stateMachine);

    // Print the URL of API Gateway
    new CfnOutput(this, 'API URL', { value: apigw.url ?? 'deployment error' });

    // Print the ARN of Step Function
    new CfnOutput(this, 'StepFunction ARN', { value: stateMachine.stateMachineArn ?? 'deployment error' });

  }
}
