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

    // Create HTTP route to Weather API
    const route = new HttpRoute(this, 'WeatherRoute', {
      httpApi: apigw,
      integration: new HttpProxyIntegration({
        url: "https://wttr.in/Wassenaar?format=3",
        method: HttpMethod.GET
      }),
      routeKey: HttpRouteKey.with("/", HttpMethod.GET),
    })

    // Create Step Function CloudWatch Logs
    const SFlogGroup = new LogGroup(this, 'SFlogGroup', {
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Create DynamoDB PutItem step with weather data and timestamp
    const ddbPutStep = new DynamoPutItem(this, 'PutItemToDynamo', {
      table: ddbTable,
      item: {
        weather: DynamoAttributeValue.fromString(JsonPath.stringAt('$.weather')),
        timest: DynamoAttributeValue.fromString(JsonPath.stringAt('$.event_date')),
      },
      resultPath: '$.ddb'
    });

    // Create GET request
    const httpGetStep = new CallApiGatewayHttpApiEndpoint(this, 'GetHTTP', {
      apiId: apigw.httpApiId,
      apiStack: Stack.of(apigw),
      method: HttpMethod.GET,
      resultPath: '$.http',
    });

    // Filter out weather data, event date and DynamoDB status from the event
    const filterStep = new Pass(this, 'FilterResponse', {
      parameters: {
        "weather.$": "$.http.ResponseBody",
        "event_date.$": "$.http.Headers.Date[0]"
      }
    });

    // Create Final Step
    const finalStep = new Pass(this, 'FinalStep', {
      parameters: {
        "weather.$": "$.weather",
        "event_date.$": "$.event_date",
        "ddb_status.$": "$.ddb.SdkHttpMetadata.HttpStatusCode"
      }
    });

    // Create Step Function definition
    const sfDefinition = httpGetStep
    .next(filterStep)
    .next(ddbPutStep)
    .next(finalStep);

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
