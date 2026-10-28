# infra — stack CDK

Um stack só, **`AgenticPaymentsAws`**, em **us-east-1**: DynamoDB, as quatro Lambdas,
AgentCore Gateway, API Gateway REST com streaming, Cognito, S3 + CloudFront. O passo a passo
do deploy está no [README do projeto](../README.md#deploy); aqui fica o que é específico da
infraestrutura e a remoção.

```bash
npm run check -w @agentic-aws/infra          # teste do template + typecheck
npm run cdk -w @agentic-aws/infra -- synth   # ou `npm run synth` na raiz (builda o front antes)
```

---

## Tags

Todo recurso que aceita tag sai com:

| Tag | Valor |
| --- | --- |
| `project` | `agentic-payments-aws` |
| `environment` | `poc` |
| `managed-by` | `cdk` |

As tags vão no próprio stack (o CloudFormation propaga) e em cada recurso do CDK. O teste do
template (`test/stack.check.ts`) confere. Para listar tudo o que existe do projeto:

```bash
aws resourcegroupstaggingapi get-resources --region us-east-1 \
  --tag-filters Key=project,Values=agentic-payments-aws \
  --query 'ResourceTagMappingList[].ResourceARN' --output text
```

**Não recebem tag** porque o CloudFormation não aceita tag nesses tipos, mas são apagados junto
com o recurso pai: rotas e métodos do API Gateway, permissões e policies de IAM, OAC do
CloudFront, domínio, client e branding do Cognito, targets do AgentCore Gateway, layer da
Lambda do deploy do site.

**Fica fora do template e sem tag:** o log group que a Lambda auxiliar de auto-delete do S3
cria sozinha (`/aws/lambda/AgenticPaymentsAws-CustomS3AutoDeleteObjects…`). O passo 5 da remoção
apaga.

---

## Remoção completa

Apaga **tudo** do projeto, inclusive as **conversas** (DynamoDB) e os **usuários** (Cognito).
Não tem volta. Faça na ordem: o `cdk destroy` apaga as saídas do stack, então anote antes o
que ele vai deixar para trás.

**0. Sessão**

```bash
export AWS_PROFILE=<seu-perfil> AWS_REGION=us-east-1
STACK=AgenticPaymentsAws
aws sts get-caller-identity --query Account --output text   # confira a conta antes de apagar
```

**1. Anote o que sobrevive ao destroy** (tabela e User Pool são `RETAIN`)

```bash
out() { aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
TABLE=$(out TableName); POOL=$(out UserPoolId)
echo "tabela=$TABLE pool=$POOL"
```

**2. Destroy do stack**

```bash
npm run cdk -w @agentic-aws/infra -- destroy
```

Apaga o CloudFront (o CloudFormation desabilita e depois apaga; leva alguns minutos), o bucket
do site com os arquivos, o API Gateway, as Lambdas e seus log groups, o AgentCore Gateway e os
targets, o domínio, o client e o branding do Cognito e os roles de IAM. Se falhar, veja o
motivo em `aws cloudformation describe-stack-events --stack-name "$STACK"`.

**3. Tabela do DynamoDB** (as conversas)

```bash
aws dynamodb delete-table --table-name "$TABLE"
aws dynamodb wait table-not-exists --table-name "$TABLE"
```

**4. User Pool do Cognito** (os usuários)

O destroy já apagou o domínio de login. Se o `delete-user-pool` reclamar de domínio, apague
o domínio primeiro:

```bash
aws cognito-idp describe-user-pool --user-pool-id "$POOL" --query 'UserPool.Domain' --output text
# se mostrar um domínio:
# aws cognito-idp delete-user-pool-domain --user-pool-id "$POOL" --domain <dominio>
aws cognito-idp delete-user-pool --user-pool-id "$POOL"
```

**5. Log groups que sobraram**

```bash
LOG_GROUPS=$(aws logs describe-log-groups --log-group-name-prefix /aws/lambda/AgenticPaymentsAws- \
  --query 'logGroups[].logGroupName' --output text)
echo "$LOG_GROUPS"   # confira: só nomes começando com /aws/lambda/AgenticPaymentsAws-
for g in $LOG_GROUPS; do aws logs delete-log-group --log-group-name "$g"; done
```

**6. Conferência**

```bash
aws cloudformation describe-stacks --stack-name "$STACK"          # "does not exist"
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=project,Values=agentic-payments-aws \
  --query 'ResourceTagMappingList[].ResourceARN' --output text      # vazio
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/AgenticPaymentsAws- \
  --query 'logGroups[].logGroupName' --output text                  # vazio
```

A API de tags pode continuar mostrando um recurso recém-apagado por alguns minutos.

### O que não apagar

- **`CDKToolkit`** (o bootstrap do CDK), o bucket `cdk-hnb659fds-assets-<conta>-us-east-1` e o
  repositório ECR do bootstrap: são **compartilhados** com os outros stacks CDK da conta. Os
  arquivos deste projeto nesse bucket (zips das Lambdas e do site, sem tag) podem ficar.
- **Acordo do Bedrock:** o projeto não cria nenhum; o Claude Haiku 4.5 já tinha acordo na conta.
