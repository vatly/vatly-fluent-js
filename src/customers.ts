import type {
  CreateCustomerRequest,
  CreatePortalSessionRequest,
  Customer,
  CustomerListParams,
  RequestOptions,
  UpdateCustomerRequest,
} from "@getvatly/sdk";
import { type CustomerProfile, FluentError, type Wiring, required } from "./contracts.js";

export class CustomerHandle {
  private cached?: Customer;
  constructor(
    private readonly wiring: Wiring,
    readonly id: string,
  ) {}
  async model(): Promise<Customer> {
    this.cached ??= await this.wiring.api.customers.get(this.id);
    return this.cached;
  }
  async name() {
    return (await this.model()).name;
  }
  async email() {
    return (await this.model()).email;
  }
  async identity() {
    const { name, email } = await this.model();
    return { name, email };
  }
  async sync(): Promise<this> {
    this.cached = await this.wiring.api.customers.get(this.id);
    return this;
  }
  async update(data: UpdateCustomerRequest, opts?: RequestOptions): Promise<this> {
    this.cached = await this.wiring.api.customers.update(this.id, data, opts);
    return this;
  }
  portalSession(body: CreatePortalSessionRequest = {}, opts?: RequestOptions) {
    return this.wiring.api.customers.createPortalSession(this.id, body, opts);
  }
}

export class CustomerService {
  constructor(private readonly wiring: Wiring) {}
  private get bindings() {
    return required(this.wiring.bindings, "bindings");
  }
  async createFor(
    hostId: string,
    profile: CustomerProfile,
    extra: Partial<CreateCustomerRequest> = {},
    opts?: RequestOptions,
  ) {
    if (await this.bindings.vatlyCustomerIdFor(hostId))
      throw new FluentError("Host customer is already bound.");
    const customer = await this.create(profile, extra, opts);
    await this.attribute(customer.id, hostId);
    return customer;
  }
  private create(
    profile: CustomerProfile,
    extra: Partial<CreateCustomerRequest>,
    opts?: RequestOptions,
  ) {
    const email = extra.email ?? profile.email;
    if (!email) throw new FluentError("An email is required to create a customer.");
    return this.wiring.api.customers.create({ name: profile.name, ...extra, email }, opts);
  }
  async createUnattributed(
    profile: CustomerProfile,
    extra: Partial<CreateCustomerRequest> = {},
    opts?: RequestOptions,
  ) {
    const customer = await this.create(profile, extra, opts);
    await this.bindings.record(customer.id);
    return customer;
  }
  async attribute(vatlyId: string, hostId: string) {
    const [existingVatly, existingHost] = await Promise.all([
      this.bindings.vatlyCustomerIdFor(hostId),
      this.bindings.hostCustomerIdFor(vatlyId),
    ]);
    if ((existingVatly && existingVatly !== vatlyId) || (existingHost && existingHost !== hostId))
      throw new FluentError("Customer is already bound to a different identity.");
    await this.bindings.bind(vatlyId, hostId);
  }
  async findByHostCustomerId(hostId: string) {
    const id = await this.bindings.vatlyCustomerIdFor(hostId);
    return id ? this.wiring.api.customers.get(id) : null;
  }
  findByVatlyCustomerId(id: string) {
    return this.wiring.api.customers.get(id);
  }
  findByEmail(email: string, params: CustomerListParams = {}) {
    return this.wiring.api.customers.listAll({ ...params, email });
  }
  async findOneByEmail(email: string) {
    for await (const customer of this.findByEmail(email)) return customer;
    return null;
  }
  identity(id: string) {
    return new CustomerHandle(this.wiring, id).identity();
  }
  update(id: string, body: UpdateCustomerRequest, opts?: RequestOptions) {
    return this.wiring.api.customers.update(id, body, opts);
  }
  hostCustomerIdFor(id: string) {
    return this.bindings.hostCustomerIdFor(id);
  }
}
