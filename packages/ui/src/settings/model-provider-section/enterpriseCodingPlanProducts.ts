import type { EnterpriseCodingPlanPricingProduct, ProviderFamilyDomain } from "@zcode/shared";

export type EnterpriseCodingPlanProductDisplay = EnterpriseCodingPlanPricingProduct & {
  productName: string;
  enterpriseProduct: EnterpriseCodingPlanPricingProduct;
  family?: ProviderFamilyDomain;
};

export function resolveEnterpriseCodingPlanProductFamily(
  product: Pick<EnterpriseCodingPlanProductDisplay, "family">,
): ProviderFamilyDomain {
  return product.family ?? "bigmodel";
}

export function buildEnterpriseCodingPlanProductList(
  products: EnterpriseCodingPlanPricingProduct[],
): EnterpriseCodingPlanProductDisplay[] {
  return products
    .filter((product) => product.subscribed === true)
    .map((product) => ({
      ...product,
      productName: product.tier.charAt(0).toUpperCase() + product.tier.slice(1).toLowerCase(),
      enterpriseProduct: product,
    }));
}
