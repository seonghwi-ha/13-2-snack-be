/*
@ 이미지 주소 만들기
- S3는 프라이빗 버킷이라 이미지는 항상 우리 API(GET /images/*key)를 거쳐서 보여준다.
- 조회에는 인증이 없어 <img>·next/image가 주소만으로 바로 불러올 수 있다.
  프론트가 Next rewrites 통로를 타도록 주소에 API_BASE(/api)를 붙여서 내려준다.
- CloudFront·presigned URL로 내려보내는 것은 이 주소를 바꾸지 않고 조회 API의 리다이렉트로 한다.
  (IMAGE_DELIVERY_MODE, image.service.ts 참고) 그래서 DB에 저장된 주소는 방식과 상관없이 그대로 쓸 수 있다.
*/
export function getImageUrl(imageKey: string): string {
  const apiBase = (process.env.API_BASE ?? '').replace(/\/+$/, '');

  return `${apiBase}/images/${imageKey}`;
}
