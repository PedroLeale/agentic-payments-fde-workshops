import { getAddress, isAddressEqual, keccak256, toHex, verifyTypedData } from "viem";
import { authorizationTypes } from "@x402/evm";
import type { ExactEIP3009Payload } from "@x402/evm";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { toChainId } from "@travel-x402/shared";
import type { Ledger } from "./ledger.js";

type Invalid = { reason: string; message: string };

/**
 * Implementacao local do scheme `exact` para redes EVM.
 *
 * A verificacao e a mesma de um facilitator de producao: reconstroi o dominio
 * EIP-712, confere a assinatura EIP-3009 do comprador e valida valor,
 * destinatario, janela de validade e replay do nonce. So a liquidacao muda -
 * em vez de chamar `transferWithAuthorization` no contrato do USDC, move o
 * saldo em um {@link Ledger} em memoria. Isso mantem o fluxo x402 fiel de ponta
 * a ponta sem exigir RPC, gas ou USDC de testnet.
 */
export class LocalLedgerExactEvmScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "eip155:*";

  constructor(private readonly ledger: Ledger) {}

  /**
   * Nao ha metadado extra especifico do mecanismo para anunciar.
   *
   * @returns undefined
   */
  getExtra(): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * Este facilitator nao assina transacoes on-chain, entao nao expoe signers.
   *
   * @returns Lista vazia
   */
  getSigners(): string[] {
    return [];
  }

  /**
   * Verifica a autorizacao de pagamento sem mover saldo.
   *
   * @param payload - Payload de pagamento enviado pelo comprador
   * @param requirements - Requisitos declarados pelo resource server
   * @returns O resultado da verificacao
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const checked = await this.check(payload, requirements);

    if ("reason" in checked) {
      return {
        isValid: false,
        invalidReason: checked.reason,
        invalidMessage: checked.message,
      };
    }

    return { isValid: true, payer: checked.authorization.from };
  }

  /**
   * Reverifica a autorizacao e liquida o pagamento no ledger.
   *
   * @param payload - Payload de pagamento enviado pelo comprador
   * @param requirements - Requisitos declarados pelo resource server
   * @returns O resultado da liquidacao
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const checked = await this.check(payload, requirements);

    if ("reason" in checked) {
      return {
        success: false,
        errorReason: checked.reason,
        errorMessage: checked.message,
        transaction: "",
        network: requirements.network,
      };
    }

    const { authorization } = checked;
    const transaction = keccak256(
      toHex(`${authorization.nonce}:${authorization.from}:${authorization.to}:${authorization.value}`),
    );

    try {
      this.ledger.settle({
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        nonce: authorization.nonce,
        transaction,
        resource: payload.resource?.url,
      });
    } catch (error) {
      return {
        success: false,
        errorReason: "settlement_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        transaction: "",
        network: requirements.network,
      };
    }

    return {
      success: true,
      payer: authorization.from,
      transaction,
      network: requirements.network,
      amount: authorization.value,
    };
  }

  /**
   * Roda todas as validacoes compartilhadas por `verify` e `settle`.
   *
   * @param payload - Payload de pagamento enviado pelo comprador
   * @param requirements - Requisitos declarados pelo resource server
   * @returns A autorizacao validada, ou o motivo da recusa
   */
  private async check(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<{ authorization: ExactEIP3009Payload["authorization"] } | Invalid> {
    if (requirements.scheme !== this.scheme) {
      return { reason: "invalid_scheme", message: `Scheme ${requirements.scheme} nao suportado` };
    }

    const { signature, authorization } = payload.payload as Partial<ExactEIP3009Payload>;

    if (!signature || !authorization) {
      return {
        reason: "invalid_exact_evm_payload",
        message: "Payload sem autorizacao EIP-3009 assinada",
      };
    }

    if (!isAddressEqual(getAddress(authorization.to), getAddress(requirements.payTo))) {
      return {
        reason: "invalid_exact_evm_payload_recipient_mismatch",
        message: `Autorizacao paga para ${authorization.to}, mas o recurso cobra para ${requirements.payTo}`,
      };
    }

    // Scheme `exact`: o valor autorizado tem que ser exatamente o cobrado.
    if (BigInt(authorization.value) !== BigInt(requirements.amount)) {
      return {
        reason: "invalid_exact_evm_payload_value",
        message: `Autorizacao de ${authorization.value}, mas o recurso cobra ${requirements.amount}`,
      };
    }

    const now = BigInt(Math.floor(Date.now() / 1000));

    if (now < BigInt(authorization.validAfter)) {
      return {
        reason: "invalid_exact_evm_payload_authorization_valid_after",
        message: "Autorizacao ainda nao e valida",
      };
    }

    if (now >= BigInt(authorization.validBefore)) {
      return {
        reason: "invalid_exact_evm_payload_authorization_valid_before",
        message: "Autorizacao expirada",
      };
    }

    const name = requirements.extra?.name;
    const version = requirements.extra?.version;

    if (typeof name !== "string" || typeof version !== "string") {
      return {
        reason: "invalid_payment_requirements",
        message: "Requisitos sem os campos EIP-712 `extra.name` e `extra.version`",
      };
    }

    const signatureIsValid = await verifyTypedData({
      address: getAddress(authorization.from),
      domain: {
        name,
        version,
        chainId: toChainId(requirements.network as Network),
        verifyingContract: getAddress(requirements.asset),
      },
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(authorization.from),
        to: getAddress(authorization.to),
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
      signature,
    });

    if (!signatureIsValid) {
      return {
        reason: "invalid_exact_evm_payload_signature",
        message: "Assinatura EIP-712 nao corresponde ao pagador declarado",
      };
    }

    if (this.ledger.isNonceUsed(authorization.nonce)) {
      return {
        reason: "invalid_exact_evm_payload_authorization_nonce",
        message: "Nonce de autorizacao ja utilizado",
      };
    }

    if (this.ledger.balanceOf(authorization.from) < BigInt(authorization.value)) {
      return {
        reason: "insufficient_funds",
        message: `Saldo insuficiente na carteira ${authorization.from}`,
      };
    }

    return { authorization };
  }
}
