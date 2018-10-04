import ApiClient from '@arkecosystem/client'
import { transactionBuilder } from '@arkecosystem/crypto'
import { castArray } from 'lodash'
import dayjs from 'dayjs'
import store from '@/store'

export default class ClientService {
  constructor () {
    this.__host = null
    this.__version = null
    this.client = new ApiClient('http://')

    this.__watchProfile()
  }

  /**
   * Fetch the network configuration according to the version.
   * Create a new client to isolate the main client.
   *
   * @param {String} server
   * @param {Number} apiVersion
   * @eturns {Object}
   */
  static async fetchNetworkConfig (server, apiVersion) {
    const client = new ApiClient(server, apiVersion)

    if (apiVersion === 1) {
      const { data } = await client.resource('loader').status()

      return data.network
    } else {
      const { data } = await client.resource('node').configuration()

      return data.data
    }
  }

  get host () {
    return this.__host
  }

  set host (host) {
    this.__host = host
    this.client.setConnection(host)
  }

  get version () {
    return this.__version
  }

  set version (apiVersion) {
    this.__version = apiVersion
    this.client.setVersion(apiVersion)
  }

  async fetchDelegates () {
    let delegates = []
    const { data } = await this.client.resource('delegates').all()

    if (this.__version === 2) {
      delegates = data.data
    } else if (data.success) {
      delegates = data.delegates.map(delegate => {
        return {
          ...delegate,
          production: {
            approval: delegate.approval,
            productivity: delegate.productivity
          },
          blocks: {
            produced: delegate.producedblocks,
            missed: delegate.missedblocks
          },
          rank: delegate.rate
        }
      })
    }

    return delegates
  }

  /**
   * Request the transactions according to the current network version
   *
   * V1:
   *   - The timestamp returned from the api is relative to the mainnet release date.
   *   - Map keys to match the v2 response structure.
   *
   * V2:
   *   - The timestamp field is an object that already returns converted date.
   *
   * @param {String} address
   * @return {Object[]}
   */
  async fetchTransactions (address) {
    let transactions = []

    if (this.__version === 1) {
      const network = store.getters['session/network']
      const { data } = await this.client.resource('transactions').all({
        recipientId: address,
        senderId: address
      })

      if (data.success) {
        transactions = data.transactions.map(tx => {
          tx.timestamp = dayjs(network.constants.epoch).add(tx.timestamp * 1000).toDate()
          tx.recipient = tx.recipientId
          tx.sender = tx.senderId

          delete tx.recipientId
          delete tx.senderId

          return tx
        })
      }
    } else {
      const { data } = await this.client.resource('wallets').transactions(address)

      transactions = data.data.map(tx => {
        tx.timestamp = dayjs(tx.timestamp.human).toDate()
        return tx
      })
    }

    // Add some utilities for each transactions
    const result = transactions.map(tx => {
      tx.isSender = tx.sender === address
      tx.isReceiver = tx.recipient === address
      tx.totalAmount = tx.amount + tx.fee

      return tx
    })

    return result
  }

  /**
   * Request the data to the wallet endpoint and unify the returned value
   *
   * V1:
   * {"success":true,"account":{"address":"ANQYF8y8PBmg67hSGCA7e67d84sgm8zH3k","unconfirmedBalance":"243884095406","balance":"243884095406","publicKey":null,"unconfirmedSignature":0,"secondSignature":0,"secondPublicKey":null,"multisignatures":[],"u_multisignatures":[]}}
   *
   * V2:
   * {"address":"DPFPtDfexMrSiZEB1o3TiJTUYBnnHrzFrD","publicKey":null,"secondPublicKey":null,"balance":1,"isDelegate":false}
   *
   * @param {String} address
   * @return {Object}
   */
  async fetchWallet (address) {
    let walletData = null

    if (this.__version === 2) {
      const { data } = await this.client.resource('wallets').get(address)
      walletData = data.data
      delete walletData.isDelegate
    } else {
      const { data } = await this.client.resource('accounts').get(address)
      if (data.success) {
        const { account } = data
        walletData = account
        delete walletData.unconfirmedBalance
        delete walletData.unconfirmedSignature
        delete walletData.secondSignature
        delete walletData.multisignatures
        delete walletData.u_multisignatures
      }
    }

    return walletData
  }

  /**
   * Build a vote transaction
   * @param {Array} votes
   * @returns {Object}
   */
  async buildVote ({ votes, passphrase }) {
    const vote = transactionBuilder
      .vote()
      .votesAsset(votes)
      .sign(passphrase)
      .getStruct()

    return vote
  }

  /**
   * Build a delegate registration transaction
   * @param {String} username
   * @param {String} passphrase
   * @returns {Object}
   */
  async buildDelegateRegistration ({ username, passphrase }) {
    const delegateRegistration = transactionBuilder
      .delegateRegistration()
      .usernameAsset(username)
      .sign(passphrase)
      .getStruct()

    return delegateRegistration
  }

  /**
   * Build a transfer transaction.
   * TODO: amount -> convert to arktoshi
   * @param {Number} amount
   * @param {String} recipientId
   * @param {String} senderPublicKey
   * @param {String} vendorField
   * @param {String} passphrase
   * @returns {Object}
   */
  async buildTransfer ({ amount, recipientId, vendorField, passphrase }) {
    const transfer = transactionBuilder
      .transfer()
      .amount(amount)
      .recipientId(recipientId)
      .vendorField(vendorField)
      .sign(passphrase)
      .getStruct()

    return transfer
  }

  /**
   * Broadcast transactions to the current peer.
   *
   * @param {Array|Object} transactions
   * @returns {Object}
   */
  async broadcastTransaction (transactions) {
    const transaction = await this
      .client
      .resource('transactions')
      .create({
        transactions: castArray(transactions)
      })

    return transaction
  }

  __watchProfile () {
    store.watch(
      (_, getters) => getters['session/profile'],
      (profile) => {
        if (!profile) return

        const { server, apiVersion } = store.getters['network/byId'](profile.networkId)

        this.host = server
        this.version = apiVersion
      },
      { immediate: true }
    )
  }
}